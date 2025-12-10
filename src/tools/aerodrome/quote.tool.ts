/**
 * Aerodrome Quote Tool
 * Returns raw swap quote data from Aerodrome Router
 * No interpretation - agent decides what the data means
 *
 * Supports both single-hop and multi-hop routes:
 * - Single-hop: Direct swap between two tokens
 * - Multi-hop: Route through an intermediate token (via parameter)
 */
import { createTool } from '@mastra/core/tools'
import { ethers } from 'ethers'
import { z } from 'zod'

import type { AerodromeRoute } from '../../config/contracts.js'
import { AERODROME_CONTRACTS, AERODROME_ROUTER_ABI, createRoute } from '../../config/contracts.js'
import { resolveToken, shouldUseStablePool } from '../../config/tokens.js'
import { getProvider } from '../../execution/wallet.js'

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
          error: `Unknown token: ${!tokenInMeta ? tokenIn : tokenOut}`,
        }
      }

      if (via && !viaMeta) {
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

      const amountInRaw = ethers.parseUnits(amountIn, tokenInMeta.decimals)

      // Build routes array (single-hop or multi-hop)
      let routes: AerodromeRoute[]
      let path: string[]
      let stableFlags: boolean | boolean[]

      if (viaMeta) {
        // Multi-hop: tokenIn → via → tokenOut
        const isStable1 = shouldUseStablePool(tokenInMeta.symbol, viaMeta.symbol)
        const isStable2 = shouldUseStablePool(viaMeta.symbol, tokenOutMeta.symbol)

        routes = [
          createRoute(tokenInMeta.address, viaMeta.address, isStable1),
          createRoute(viaMeta.address, tokenOutMeta.address, isStable2),
        ]
        path = [tokenInMeta.symbol, viaMeta.symbol, tokenOutMeta.symbol]
        stableFlags = [isStable1, isStable2]
      } else {
        // Single-hop: tokenIn → tokenOut (existing behavior)
        const isStable = shouldUseStablePool(tokenIn, tokenOut)
        routes = [createRoute(tokenInMeta.address, tokenOutMeta.address, isStable)]
        path = [tokenInMeta.symbol, tokenOutMeta.symbol]
        stableFlags = isStable
      }

      const provider = getProvider()
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
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
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
