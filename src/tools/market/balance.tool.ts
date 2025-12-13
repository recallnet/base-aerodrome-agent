/**
 * Wallet Balance Tool
 * Returns raw balance data for the trading wallet
 * No interpretation - agent decides what the data means
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { type TokenSymbol, resolveToken } from '../../config/tokens.js'
import {
  getBatchTokenBalances,
  getEthBalance,
  getWalletAddress,
  isWalletConfigured,
} from '../../execution/wallet.js'

/** Output schema for balance entries */
const balanceEntrySchema = z.object({
  symbol: z.string(),
  address: z.string(),
  balance: z.string(),
  balanceRaw: z.string(),
  decimals: z.number(),
})

type BalanceEntry = z.infer<typeof balanceEntrySchema>

export const getWalletBalanceTool = createTool({
  id: 'get-wallet-balance',
  description: `Get current wallet balances for ETH and configured tokens.
Returns raw balance data for portfolio assessment.
Use this to check available funds before trading.`,

  inputSchema: z.object({
    tokens: z
      .array(z.string())
      .optional()
      .describe('Specific tokens to check (defaults to ETH, WETH, USDC, AERO)'),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    walletAddress: z.string().nullable(),
    balances: z.array(balanceEntrySchema),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { tokens } = context

    if (!isWalletConfigured()) {
      console.error(`  ❌ getWalletBalance FAILED: Wallet not configured`)
      return {
        success: false,
        walletAddress: null,
        balances: [],
        error: 'Wallet not configured. Set AGENT_PRIVATE_KEY environment variable.',
      }
    }

    try {
      const walletAddress = getWalletAddress()
      const balances: BalanceEntry[] = []

      // Get native ETH balance
      const ethBalance = await getEthBalance()
      balances.push({
        symbol: 'ETH',
        address: ethBalance.address,
        balance: ethBalance.balanceFormatted,
        balanceRaw: ethBalance.balance.toString(),
        decimals: ethBalance.decimals,
      })

      // Resolve requested tokens to valid TokenSymbols
      const defaultTokens: TokenSymbol[] = ['WETH', 'USDC', 'AERO']
      const tokensToCheck: TokenSymbol[] = tokens
        ? tokens
            .map((t) => resolveToken(t))
            .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined)
            .map((meta) => meta.symbol)
        : defaultTokens

      // Batch fetch all token balances in a single call
      const tokenBalances = await getBatchTokenBalances(tokensToCheck)

      for (const tokenBalance of tokenBalances) {
        balances.push({
          symbol: tokenBalance.symbol,
          address: tokenBalance.address,
          balance: tokenBalance.balanceFormatted,
          balanceRaw: tokenBalance.balance.toString(),
          decimals: tokenBalance.decimals,
        })
      }

      return {
        success: true,
        walletAddress,
        balances,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`  ❌ getWalletBalance FAILED: ${errorMessage}`)
      return {
        success: false,
        walletAddress: null,
        balances: [],
        error: errorMessage,
      }
    }
  },
})
