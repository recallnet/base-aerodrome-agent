/**
 * Aerodrome Quote Tool
 * Returns raw swap quote data from Aerodrome DEX
 * No interpretation - agent decides what the data means
 *
 * Supports both pool types:
 * - Slipstream (CL): Concentrated liquidity pools with lower fees (0.05%)
 * - V2 (Classic AMM): Traditional x*y=k pools with higher fees (0.3%)
 *
 * And routing options:
 * - Single-hop: Direct swap between two tokens
 * - Multi-hop: Route through an intermediate token (via parameter)
 *
 * Pool Discovery:
 * - Uses on-chain factory contracts to discover pools dynamically
 * - No hardcoded pool addresses needed
 */
import { createTool } from '@mastra/core/tools'
import { ethers } from 'ethers'
import { z } from 'zod'

import type { AerodromeRoute } from '../../config/contracts.js'
import {
  AERODROME_CONTRACTS,
  AERODROME_ROUTER_ABI,
  SLIPSTREAM_POOL_ABI,
  createRoute,
} from '../../config/contracts.js'
import { discoverBestPool } from '../../config/pool-discovery.js'
import type { PoolType } from '../../config/pools.js'
import { resolveToken, shouldUseStablePool } from '../../config/tokens.js'
import { getProvider } from '../../execution/wallet.js'

/** Fee percentages for different pool types */
const POOL_FEES: Record<PoolType, number> = {
  slipstream: 0.05, // 0.05% for CL pools
  v2: 0.3, // 0.3% for volatile V2 pools
}

/**
 * Calculate price from Slipstream sqrtPriceX96
 * Formula: price = (sqrtPriceX96 / 2^96)^2 adjusted for decimals
 */
function calculateSlipstreamPrice(
  sqrtPriceX96: bigint,
  baseIsToken0: boolean,
  baseDecimals: number,
  quoteDecimals: number
): number {
  const Q96 = BigInt(2) ** BigInt(96)
  const sqrtPriceRatio = Number(sqrtPriceX96) / Number(Q96)
  const rawPrice = sqrtPriceRatio ** 2
  // rawPrice = token1/token0 in raw units (before decimal adjustment)
  return baseIsToken0
    ? rawPrice * 10 ** (baseDecimals - quoteDecimals)
    : (1 / rawPrice) * 10 ** (baseDecimals - quoteDecimals)
}

/**
 * Get quote from Slipstream (CL) pool
 * Reads sqrtPriceX96 from pool slot0 and calculates expected output
 */
async function getSlipstreamQuote(
  provider: ethers.Provider,
  poolAddress: string,
  tokenInAddress: string,
  tokenOutAddress: string,
  amountIn: number,
  tokenInDecimals: number,
  tokenOutDecimals: number
): Promise<{ amountOut: number; spotPrice: number }> {
  const pool = new ethers.Contract(poolAddress, SLIPSTREAM_POOL_ABI, provider)

  // Get pool token ordering and price
  const [token0, slot0] = await Promise.all([
    pool.token0() as Promise<string>,
    pool.slot0() as Promise<{ sqrtPriceX96: bigint }>,
  ])

  const tokenInIsToken0 = token0.toLowerCase() === tokenInAddress.toLowerCase()

  // Calculate price: how much tokenOut per tokenIn
  const spotPrice = calculateSlipstreamPrice(
    slot0.sqrtPriceX96,
    tokenInIsToken0,
    tokenInDecimals,
    tokenOutDecimals
  )

  // Apply fee
  const feeMultiplier = 1 - POOL_FEES.slipstream / 100
  const amountOut = amountIn * spotPrice * feeMultiplier

  return { amountOut, spotPrice }
}

export const getQuoteTool = createTool({
  id: 'aerodrome-get-quote',
  description: `Get a swap quote from Aerodrome DEX on Base chain.
Returns expected output amount and route information.
Use this to check swap prices before executing trades.

Supports multi-hop routing with the optional 'via' parameter:
- Direct: getQuote({ tokenIn: "USDC", tokenOut: "WETH", amountIn: "10" })
- Multi-hop: getQuote({ tokenIn: "USDC", tokenOut: "BRETT", amountIn: "10", via: "WETH" })

Use 'via' when no direct pool exists or to get better rates through WETH/USDC.`,

  inputSchema: z.object({
    tokenIn: z.string().describe("Input token symbol (e.g., 'WETH', 'USDC') or address"),
    tokenOut: z.string().describe("Output token symbol (e.g., 'AERO', 'USDC') or address"),
    amountIn: z.string().describe("Amount to swap in human-readable format (e.g., '1.5')"),
    via: z
      .string()
      .optional()
      .describe("Optional intermediate token for multi-hop routing (e.g., 'WETH')"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    tokenIn: z.object({
      symbol: z.string(),
      address: z.string(),
      decimals: z.number(),
      amountIn: z.string(),
      amountInRaw: z.string(),
    }),
    tokenOut: z.object({
      symbol: z.string(),
      address: z.string(),
      decimals: z.number(),
      amountOut: z.string(),
      amountOutRaw: z.string(),
    }),
    route: z.object({
      path: z.array(z.string()),
      hops: z.number(),
      stable: z.union([z.boolean(), z.array(z.boolean())]),
    }),
    /** Pool type used: 'slipstream' (CL) or 'v2' (classic AMM) */
    poolType: z.enum(['slipstream', 'v2']).optional(),
    /** Tick spacing for Slipstream pools */
    tickSpacing: z.number().optional(),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { tokenIn, tokenOut, amountIn, via } = context

    try {
      const tokenInMeta = resolveToken(tokenIn)
      const tokenOutMeta = resolveToken(tokenOut)
      const viaMeta = via ? resolveToken(via) : null

      // Validate all tokens
      if (!tokenInMeta || !tokenOutMeta) {
        const unknownToken = !tokenInMeta ? tokenIn : tokenOut
        console.error(`  ❌ getQuote FAILED: Unknown token: ${unknownToken}`)
        return {
          success: false,
          tokenIn: { symbol: tokenIn, address: '', decimals: 0, amountIn: '0', amountInRaw: '0' },
          tokenOut: {
            symbol: tokenOut,
            address: '',
            decimals: 0,
            amountOut: '0',
            amountOutRaw: '0',
          },
          route: { path: [], hops: 0, stable: false },
          error: `Unknown token: ${unknownToken}`,
        }
      }

      if (via && !viaMeta) {
        console.error(`  ❌ getQuote FAILED: Unknown intermediate token: ${via}`)
        return {
          success: false,
          tokenIn: { symbol: tokenIn, address: '', decimals: 0, amountIn: '0', amountInRaw: '0' },
          tokenOut: {
            symbol: tokenOut,
            address: '',
            decimals: 0,
            amountOut: '0',
            amountOutRaw: '0',
          },
          route: { path: [], hops: 0, stable: false },
          error: `Unknown intermediate token: ${via}`,
        }
      }

      // Validate via token isn't same as tokenIn or tokenOut (LLM hallucination guard)
      if (viaMeta) {
        if (viaMeta.address.toLowerCase() === tokenOutMeta.address.toLowerCase()) {
          console.warn(`  ⚠️ Ignoring 'via' parameter - same as tokenOut (${via})`)
          // Clear viaMeta to use direct swap instead
        } else if (viaMeta.address.toLowerCase() === tokenInMeta.address.toLowerCase()) {
          console.warn(`  ⚠️ Ignoring 'via' parameter - same as tokenIn (${via})`)
          // Clear viaMeta to use direct swap instead
        }
      }

      // If via is invalid (same as in/out), treat as null for direct swap
      const effectiveViaMeta =
        viaMeta &&
        viaMeta.address.toLowerCase() !== tokenOutMeta.address.toLowerCase() &&
        viaMeta.address.toLowerCase() !== tokenInMeta.address.toLowerCase()
          ? viaMeta
          : null

      const provider = getProvider()
      const amountInNum = parseFloat(amountIn)
      const amountInRaw = ethers.parseUnits(amountIn, tokenInMeta.decimals)

      // Dynamically discover the best pool for direct swaps (single-hop without via)
      const discoveredPool = !effectiveViaMeta
        ? await discoverBestPool(provider, tokenInMeta.address, tokenOutMeta.address)
        : null

      // === SLIPSTREAM (CL) POOL QUOTE ===
      if (discoveredPool?.type === 'slipstream' && !effectiveViaMeta) {
        console.log(
          `  📊 Found Slipstream pool for ${tokenInMeta.symbol}→${tokenOutMeta.symbol} at ${discoveredPool.address} (tick: ${discoveredPool.tickSpacing})`
        )

        const { amountOut } = await getSlipstreamQuote(
          provider,
          discoveredPool.address,
          tokenInMeta.address,
          tokenOutMeta.address,
          amountInNum,
          tokenInMeta.decimals,
          tokenOutMeta.decimals
        )

        const amountOutRaw = ethers.parseUnits(
          amountOut.toFixed(tokenOutMeta.decimals),
          tokenOutMeta.decimals
        )

        return {
          success: true,
          tokenIn: {
            symbol: tokenInMeta.symbol,
            address: tokenInMeta.address,
            decimals: tokenInMeta.decimals,
            amountIn,
            amountInRaw: amountInRaw.toString(),
          },
          tokenOut: {
            symbol: tokenOutMeta.symbol,
            address: tokenOutMeta.address,
            decimals: tokenOutMeta.decimals,
            amountOut: amountOut.toFixed(tokenOutMeta.decimals),
            amountOutRaw: amountOutRaw.toString(),
          },
          route: {
            path: [tokenInMeta.symbol, tokenOutMeta.symbol],
            hops: 1,
            stable: false, // Slipstream pools aren't categorized as stable/volatile
          },
          poolType: 'slipstream' as const,
          tickSpacing: discoveredPool.tickSpacing,
        }
      }

      // === V2 (CLASSIC AMM) POOL QUOTE ===
      // Build routes array (single-hop or multi-hop)
      let routes: AerodromeRoute[]
      let path: string[]
      let stableFlags: boolean | boolean[]

      if (effectiveViaMeta) {
        // Multi-hop: tokenIn → via → tokenOut
        const isStable1 = shouldUseStablePool(tokenInMeta.symbol, effectiveViaMeta.symbol)
        const isStable2 = shouldUseStablePool(effectiveViaMeta.symbol, tokenOutMeta.symbol)

        routes = [
          createRoute(tokenInMeta.address, effectiveViaMeta.address, isStable1),
          createRoute(effectiveViaMeta.address, tokenOutMeta.address, isStable2),
        ]
        path = [tokenInMeta.symbol, effectiveViaMeta.symbol, tokenOutMeta.symbol]
        stableFlags = [isStable1, isStable2]
      } else {
        // Single-hop: tokenIn → tokenOut
        const isStable = shouldUseStablePool(tokenIn, tokenOut)
        routes = [createRoute(tokenInMeta.address, tokenOutMeta.address, isStable)]
        path = [tokenInMeta.symbol, tokenOutMeta.symbol]
        stableFlags = isStable
      }

      console.log(`  📊 Using V2 router for ${path.join('→')}`)

      const router = new ethers.Contract(
        AERODROME_CONTRACTS.ROUTER_V2,
        AERODROME_ROUTER_ABI,
        provider
      )

      // Call getAmountsOut with routes array
      const getAmountsOutFn = router.getFunction('getAmountsOut')
      const amounts = (await getAmountsOutFn(amountInRaw, routes)) as bigint[]
      const amountOutRaw = amounts[amounts.length - 1]
      const amountOut = ethers.formatUnits(amountOutRaw, tokenOutMeta.decimals)

      return {
        success: true,
        tokenIn: {
          symbol: tokenInMeta.symbol,
          address: tokenInMeta.address,
          decimals: tokenInMeta.decimals,
          amountIn,
          amountInRaw: amountInRaw.toString(),
        },
        tokenOut: {
          symbol: tokenOutMeta.symbol,
          address: tokenOutMeta.address,
          decimals: tokenOutMeta.decimals,
          amountOut,
          amountOutRaw: amountOutRaw.toString(),
        },
        route: {
          path,
          hops: routes.length,
          stable: stableFlags,
        },
        poolType: 'v2' as const,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`  ❌ getQuote FAILED for ${tokenIn}→${tokenOut}: ${errorMessage}`)
      return {
        success: false,
        tokenIn: { symbol: tokenIn, address: '', decimals: 0, amountIn: '0', amountInRaw: '0' },
        tokenOut: { symbol: tokenOut, address: '', decimals: 0, amountOut: '0', amountOutRaw: '0' },
        route: { path: [], hops: 0, stable: false },
        error: errorMessage,
      }
    }
  },
})
