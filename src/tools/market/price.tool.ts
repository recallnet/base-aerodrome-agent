/**
 * Token Price Tool
 * Returns raw price data from external APIs
 * No interpretation - agent decides what the data means
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { resolveToken } from '../../config/tokens.js'

/**
 * Fetch token data from DexScreener API
 * Returns raw API response
 */
async function fetchDexScreenerData(tokenAddress: string): Promise<{
  priceUsd: string | null
  priceChange24h: number | null
  volume24h: number | null
  liquidity: number | null
  fdv: number | null
  pairAddress: string | null
}> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)

    if (!response.ok) {
      return {
        priceUsd: null,
        priceChange24h: null,
        volume24h: null,
        liquidity: null,
        fdv: null,
        pairAddress: null,
      }
    }

    const data = (await response.json()) as {
      pairs?: Array<{
        chainId: string
        priceUsd?: string
        priceChange?: { h24?: number }
        volume?: { h24?: number }
        liquidity?: { usd?: number }
        fdv?: number
        pairAddress?: string
      }>
    }

    if (data.pairs && data.pairs.length > 0) {
      // Find the Base chain pair with highest liquidity
      const basePairs = data.pairs.filter((p) => p.chainId === 'base')
      if (basePairs.length === 0) {
        return {
          priceUsd: null,
          priceChange24h: null,
          volume24h: null,
          liquidity: null,
          fdv: null,
          pairAddress: null,
        }
      }

      const bestPair = basePairs.sort(
        (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0]

      return {
        priceUsd: bestPair.priceUsd || null,
        priceChange24h: bestPair.priceChange?.h24 || null,
        volume24h: bestPair.volume?.h24 || null,
        liquidity: bestPair.liquidity?.usd || null,
        fdv: bestPair.fdv || null,
        pairAddress: bestPair.pairAddress || null,
      }
    }

    return {
      priceUsd: null,
      priceChange24h: null,
      volume24h: null,
      liquidity: null,
      fdv: null,
      pairAddress: null,
    }
  } catch {
    return {
      priceUsd: null,
      priceChange24h: null,
      volume24h: null,
      liquidity: null,
      fdv: null,
      pairAddress: null,
    }
  }
}

export const getTokenPriceTool = createTool({
  id: 'get-token-price',
  description: `Get current token price and market data from DexScreener.
Returns raw price, volume, and liquidity data.
Use this to check current token prices.`,

  inputSchema: z.object({
    token: z.string().describe("Token symbol (e.g., 'AERO', 'WETH') or address"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    token: z.object({
      symbol: z.string(),
      address: z.string(),
    }),
    price: z.object({
      usd: z.string().nullable(),
      change24hPercent: z.number().nullable(),
    }),
    market: z.object({
      volume24hUsd: z.number().nullable(),
      liquidityUsd: z.number().nullable(),
      fdv: z.number().nullable(),
    }),
    source: z.string(),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { token } = context

    // Debug: log raw input to catch model hallucinations
    console.log(`  🔍 getTokenPrice input: token="${token}"`)

    try {
      const tokenMeta = resolveToken(token)

      if (!tokenMeta) {
        console.error(`  ❌ getTokenPrice FAILED: Unknown token: ${token}`)
        return {
          success: false,
          token: { symbol: token, address: '' },
          price: { usd: null, change24hPercent: null },
          market: { volume24hUsd: null, liquidityUsd: null, fdv: null },
          source: 'dexscreener',
          error: `Unknown token: ${token}`,
        }
      }

      const data = await fetchDexScreenerData(tokenMeta.address)

      if (data.priceUsd === null) {
        console.error(`  ❌ getTokenPrice FAILED: No price data for ${tokenMeta.symbol}`)
      }

      return {
        success: data.priceUsd !== null,
        token: {
          symbol: tokenMeta.symbol,
          address: tokenMeta.address,
        },
        price: {
          usd: data.priceUsd,
          change24hPercent: data.priceChange24h,
        },
        market: {
          volume24hUsd: data.volume24h,
          liquidityUsd: data.liquidity,
          fdv: data.fdv,
        },
        source: 'dexscreener',
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`  ❌ getTokenPrice FAILED: ${errorMessage}`)
      return {
        success: false,
        token: { symbol: token, address: '' },
        price: { usd: null, change24hPercent: null },
        market: { volume24hUsd: null, liquidityUsd: null, fdv: null },
        source: 'dexscreener',
        error: errorMessage,
      }
    }
  },
})
