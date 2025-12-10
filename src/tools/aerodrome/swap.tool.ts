/**
 * Aerodrome Swap Execution Tool
 * Executes token swaps on Aerodrome Router
 * Returns raw transaction result
 *
 * SAFETY: Trades are blocked when:
 * - DRY_RUN=true (recommended for testing)
 * - TEST_MODE=true
 * - NODE_ENV=test
 * - No AGENT_PRIVATE_KEY configured
 *
 * TRACKING: On successful execution:
 * - Logs trade to swap_transactions table
 * - Updates positions table with cost basis
 *
 * MULTI-HOP: Supports routing through an intermediate token:
 * - Single-hop: executeSwap({ tokenIn: "USDC", tokenOut: "WETH", ... })
 * - Multi-hop: executeSwap({ tokenIn: "USDC", tokenOut: "BRETT", via: "WETH", ... })
 */
import { createTool } from '@mastra/core/tools'
import { ethers } from 'ethers'
import { z } from 'zod'

import type { AerodromeRoute } from '../../config/contracts.js'
import { AERODROME_CONTRACTS, AERODROME_ROUTER_ABI, createRoute } from '../../config/contracts.js'
import { ENV_CONFIG, TRADING_CONFIG } from '../../config/index.js'
import { TOKEN_ADDRESSES, resolveToken, shouldUseStablePool } from '../../config/tokens.js'
import { swapTransactionsRepo } from '../../database/repositories/index.js'
import { approveToken, getProvider, getWallet, isWalletConfigured } from '../../execution/wallet.js'
import { performanceTracker } from '../../services/performance-tracker.js'

/** Stablecoin tokens - don't track positions for these (they're ~$1, no P&L to track) */
const STABLECOIN_TOKENS = ['USDC', 'USDbC', 'DAI']

/** Check if a token is a stablecoin (excluded from position tracking) */
function isStablecoin(symbol: string): boolean {
  return STABLECOIN_TOKENS.includes(symbol.toUpperCase())
}

/** DexScreener response type */
interface DexScreenerResponse {
  pairs?: Array<{
    chainId: string
    priceUsd?: string
    liquidity?: { usd?: number }
  }>
}

/** Fetch current USD price for a token */
async function fetchTokenPriceUsd(tokenAddress: string): Promise<number> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)
    if (!response.ok) return 0

    const data = (await response.json()) as DexScreenerResponse

    if (data.pairs && data.pairs.length > 0) {
      const basePairs = data.pairs.filter((p) => p.chainId === 'base')
      if (basePairs.length === 0) return 0

      const bestPair = basePairs.sort(
        (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0]

      return parseFloat(bestPair.priceUsd || '0')
    }
    return 0
  } catch {
    return 0
  }
}

export const executeSwapTool = createTool({
  id: 'aerodrome-execute-swap',
  description: `Execute a token swap on Aerodrome DEX.
Only call this when you have decided to trade AND you are confident.
Requires wallet to be configured with AGENT_PRIVATE_KEY.
NOTE: Trades are blocked in DRY_RUN mode - the tool will return an error instead of executing.

Supports multi-hop routing with the optional 'via' parameter:
- Direct: executeSwap({ tokenIn: "USDC", tokenOut: "WETH", amountIn: "10", minAmountOut: "0.003" })
- Multi-hop: executeSwap({ tokenIn: "USDC", tokenOut: "BRETT", via: "WETH", amountIn: "10", minAmountOut: "1000" })

Use 'via' when no direct pool exists (e.g., USDC→BRETT requires routing through WETH).`,

  inputSchema: z.object({
    tokenIn: z.string().describe('Input token symbol or address'),
    tokenOut: z.string().describe('Output token symbol or address'),
    amountIn: z.string().describe('Amount to swap in human-readable format'),
    minAmountOut: z.string().describe('Minimum acceptable output amount'),
    slippagePercent: z.number().default(0.5).describe('Slippage tolerance percentage'),
    via: z
      .string()
      .optional()
      .describe("Optional intermediate token for multi-hop routing (e.g., 'WETH')"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    txHash: z.string().optional(),
    tokenIn: z.object({
      symbol: z.string(),
      amount: z.string(),
    }),
    tokenOut: z.object({
      symbol: z.string(),
      amountExpected: z.string(),
      amountMin: z.string(),
    }),
    gasUsed: z.string().optional(),
    error: z.string().optional(),
    dryRun: z.boolean().optional(),
  }),

  execute: async ({ context }) => {
    const { tokenIn, tokenOut, amountIn, minAmountOut, via } = context

    // SAFETY: Block execution in dry run / test mode to prevent accidental trades
    if (ENV_CONFIG.dryRun || ENV_CONFIG.isTest) {
      const routeStr = via ? `${tokenIn} → ${via} → ${tokenOut}` : `${tokenIn} → ${tokenOut}`
      console.log(`🚫 [DRY RUN] Would swap ${amountIn} ${routeStr} (min: ${minAmountOut})`)
      return {
        success: false,
        dryRun: true,
        tokenIn: { symbol: tokenIn, amount: amountIn },
        tokenOut: { symbol: tokenOut, amountExpected: minAmountOut, amountMin: minAmountOut },
        error:
          'DRY RUN: Trade was simulated but NOT executed. Set DRY_RUN=false to enable real trades.',
      }
    }

    // Check wallet configuration
    if (!isWalletConfigured()) {
      return {
        success: false,
        tokenIn: { symbol: tokenIn, amount: amountIn },
        tokenOut: { symbol: tokenOut, amountExpected: '0', amountMin: minAmountOut },
        error: 'Wallet not configured. Set AGENT_PRIVATE_KEY environment variable.',
      }
    }

    try {
      const tokenInMeta = resolveToken(tokenIn)
      const tokenOutMeta = resolveToken(tokenOut)
      const viaMeta = via ? resolveToken(via) : null

      if (!tokenInMeta || !tokenOutMeta) {
        return {
          success: false,
          tokenIn: { symbol: tokenIn, amount: amountIn },
          tokenOut: { symbol: tokenOut, amountExpected: '0', amountMin: minAmountOut },
          error: `Unknown token: ${!tokenInMeta ? tokenIn : tokenOut}`,
        }
      }

      if (via && !viaMeta) {
        return {
          success: false,
          tokenIn: { symbol: tokenIn, amount: amountIn },
          tokenOut: { symbol: tokenOut, amountExpected: '0', amountMin: minAmountOut },
          error: `Unknown intermediate token: ${via}`,
        }
      }

      const wallet = getWallet()
      const amountInRaw = ethers.parseUnits(amountIn, tokenInMeta.decimals)
      const minAmountOutRaw = ethers.parseUnits(minAmountOut, tokenOutMeta.decimals)
      const deadline = Math.floor(Date.now() / 1000) + TRADING_CONFIG.txDeadlineSeconds

      // Build routes array (single-hop or multi-hop)
      let routes: AerodromeRoute[]
      let isStable: boolean

      if (viaMeta) {
        // Multi-hop: tokenIn → via → tokenOut
        const isStable1 = shouldUseStablePool(tokenInMeta.symbol, viaMeta.symbol)
        const isStable2 = shouldUseStablePool(viaMeta.symbol, tokenOutMeta.symbol)
        routes = [
          createRoute(tokenInMeta.address, viaMeta.address, isStable1),
          createRoute(viaMeta.address, tokenOutMeta.address, isStable2),
        ]
        isStable = isStable1 && isStable2 // For logging purposes
        console.log(
          `🔀 Multi-hop route: ${tokenInMeta.symbol} → ${viaMeta.symbol} → ${tokenOutMeta.symbol}`
        )
      } else {
        // Single-hop: tokenIn → tokenOut (existing behavior)
        isStable = shouldUseStablePool(tokenIn, tokenOut)
        routes = [createRoute(tokenInMeta.address, tokenOutMeta.address, isStable)]
      }

      const router = new ethers.Contract(
        AERODROME_CONTRACTS.ROUTER_V2,
        AERODROME_ROUTER_ABI,
        wallet
      )

      let tx: ethers.ContractTransactionResponse

      // Check if swapping from native ETH
      const isFromETH = tokenInMeta.address.toLowerCase() === TOKEN_ADDRESSES.WETH.toLowerCase()

      if (isFromETH) {
        // Swap ETH for tokens (works with multi-hop routes)
        const swapEthFn = router.getFunction('swapExactETHForTokens')
        tx = (await swapEthFn(minAmountOutRaw, routes, wallet.address, deadline, {
          value: amountInRaw,
        })) as ethers.ContractTransactionResponse
      } else {
        // Approve token spending if needed
        await approveToken(tokenInMeta.address, AERODROME_CONTRACTS.ROUTER_V2, amountInRaw)

        // Check if swapping to native ETH
        const isToETH = tokenOutMeta.address.toLowerCase() === TOKEN_ADDRESSES.WETH.toLowerCase()

        if (isToETH) {
          const swapToEthFn = router.getFunction('swapExactTokensForETH')
          tx = (await swapToEthFn(
            amountInRaw,
            minAmountOutRaw,
            routes,
            wallet.address,
            deadline
          )) as ethers.ContractTransactionResponse
        } else {
          const swapTokensFn = router.getFunction('swapExactTokensForTokens')
          tx = (await swapTokensFn(
            amountInRaw,
            minAmountOutRaw,
            routes,
            wallet.address,
            deadline
          )) as ethers.ContractTransactionResponse
        }
      }

      const receipt = await tx.wait()

      // === TRADE TRACKING ===
      // Log to swap_transactions and update positions for P&L tracking
      if (receipt?.hash) {
        try {
          // Fetch current prices for USD values
          const tokenInPriceUsd = await fetchTokenPriceUsd(tokenInMeta.address)
          const tokenOutPriceUsd = await fetchTokenPriceUsd(tokenOutMeta.address)
          const amountInNum = parseFloat(amountIn)
          const amountOutNum = parseFloat(minAmountOut) // Using min as expected
          const amountInUsd = amountInNum * tokenInPriceUsd
          const amountOutUsd = amountOutNum * tokenOutPriceUsd

          // Get gas cost in USD (ETH price * gas used * gas price)
          const provider = getProvider()
          const feeData = await provider.getFeeData()
          const gasUsedBn = receipt.gasUsed
          const gasPriceGwei = feeData.gasPrice
            ? parseFloat(ethers.formatUnits(feeData.gasPrice, 'gwei'))
            : 0
          const gasCostEth =
            gasUsedBn && feeData.gasPrice
              ? parseFloat(ethers.formatEther(gasUsedBn * feeData.gasPrice))
              : 0
          const ethPriceUsd = await fetchTokenPriceUsd(TOKEN_ADDRESSES.WETH)
          const gasCostUsd = gasCostEth * ethPriceUsd

          // Log to swap_transactions table
          // For multi-hop, we log the overall swap (tokenIn → tokenOut)
          await swapTransactionsRepo.logSwap({
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            timestamp: new Date(),
            tokenIn: tokenInMeta.symbol,
            tokenInAddress: tokenInMeta.address,
            amountIn: amountIn,
            amountInUsd: amountInUsd.toFixed(2),
            tokenOut: tokenOutMeta.symbol,
            tokenOutAddress: tokenOutMeta.address,
            amountOut: minAmountOut,
            amountOutUsd: amountOutUsd.toFixed(2),
            poolAddress: routes[0].from, // First hop's input token address
            isStablePool: isStable,
            gasUsed: Number(gasUsedBn),
            gasPriceGwei: gasPriceGwei.toFixed(4),
            gasCostUsd: gasCostUsd.toFixed(4),
            status: 'SUCCESS',
          })

          // Update positions for P&L tracking
          // Determine if this is a BUY or SELL based on quote tokens
          const tokenInIsStable = isStablecoin(tokenInMeta.symbol)
          const tokenOutIsStable = isStablecoin(tokenOutMeta.symbol)

          if (tokenInIsStable && !tokenOutIsStable) {
            // BUY: Spending stablecoin to get volatile token (WETH, AERO, etc.)
            await performanceTracker.recordBuy(
              tokenOutMeta.symbol,
              tokenOutMeta.address,
              amountOutNum,
              amountInUsd // Cost in USD
            )
            console.log(
              `📊 Recorded BUY: ${amountOutNum} ${tokenOutMeta.symbol} for $${amountInUsd.toFixed(2)}`
            )
          } else if (!tokenInIsStable && tokenOutIsStable) {
            // SELL: Selling volatile token to get stablecoin
            const sellResult = await performanceTracker.recordSell(
              tokenInMeta.symbol,
              amountInNum,
              amountOutUsd // Proceeds in USD
            )
            if (sellResult) {
              console.log(
                `📊 Recorded SELL: ${amountInNum} ${tokenInMeta.symbol} for $${amountOutUsd.toFixed(2)} (P&L: $${sellResult.realizedPnl.toFixed(2)})`
              )
            } else {
              console.log(
                `📊 Sale logged: ${amountInNum} ${tokenInMeta.symbol} for $${amountOutUsd.toFixed(2)} (P&L not tracked - no cost basis)`
              )
            }
          } else {
            // Volatile-to-volatile swap (e.g., WETH → AERO, AERO → BRETT)
            // Record as SELL of tokenIn and BUY of tokenOut
            if (!tokenInIsStable) {
              const sellResult = await performanceTracker.recordSell(
                tokenInMeta.symbol,
                amountInNum,
                amountInUsd
              )
              if (!sellResult) {
                console.log(`📊 ${tokenInMeta.symbol} sale not tracked (no cost basis)`)
              }
            }
            if (!tokenOutIsStable) {
              await performanceTracker.recordBuy(
                tokenOutMeta.symbol,
                tokenOutMeta.address,
                amountOutNum,
                amountOutUsd
              )
            }
            console.log(`📊 Recorded swap: ${tokenInMeta.symbol} → ${tokenOutMeta.symbol}`)
          }
        } catch (trackingError) {
          // Don't fail the swap if tracking fails - just log the error
          console.error('⚠️ Trade tracking failed (swap succeeded):', trackingError)
        }
      }
      // === END TRADE TRACKING ===

      return {
        success: true,
        txHash: receipt?.hash,
        tokenIn: {
          symbol: tokenInMeta.symbol,
          amount: amountIn,
        },
        tokenOut: {
          symbol: tokenOutMeta.symbol,
          amountExpected: minAmountOut,
          amountMin: minAmountOut,
        },
        gasUsed: receipt?.gasUsed?.toString(),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        tokenIn: { symbol: tokenIn, amount: amountIn },
        tokenOut: { symbol: tokenOut, amountExpected: '0', amountMin: minAmountOut },
        error: errorMessage,
      }
    }
  },
})
