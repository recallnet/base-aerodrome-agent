/**
 * Aerodrome Pool Metrics Tool
 * Returns raw pool data - reserves (V2) or liquidity (Slipstream)
 * No interpretation - agent decides what the data means
 *
 * Supports both pool types:
 * - Slipstream (CL): Concentrated liquidity pools - returns liquidity and sqrtPriceX96
 * - V2 (Classic AMM): Traditional x*y=k pools - returns reserves
 *
 * Pool Discovery:
 * - Uses on-chain factory contracts to discover pools dynamically
 * - No hardcoded pool addresses needed
 */
import { createTool } from '@mastra/core/tools'
import { ethers } from 'ethers'
import { z } from 'zod'

import { AERODROME_POOL_ABI, SLIPSTREAM_POOL_ABI } from '../../config/contracts.js'
import { type DiscoveredPool, discoverBestPool } from '../../config/pool-discovery.js'
import type { PoolType } from '../../config/pools.js'
import { resolveToken } from '../../config/tokens.js'
import { getProvider } from '../../execution/wallet.js'

export const getPoolMetricsTool = createTool({
  id: 'aerodrome-pool-metrics',
  description: `Get raw liquidity pool data from Aerodrome DEX.
Returns reserves (V2) or liquidity metrics (Slipstream CL pools).
Use this to assess pool depth before trading.`,

  inputSchema: z.object({
    tokenA: z.string().describe("First token symbol (e.g., 'WETH') or address"),
    tokenB: z.string().describe("Second token symbol (e.g., 'USDC') or address"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    poolAddress: z.string(),
    /** Pool type: 'slipstream' (CL) or 'v2' (classic AMM) */
    poolType: z.enum(['slipstream', 'v2']),
    /** For V2 pools only: whether it's a stable or volatile pool */
    isStable: z.boolean(),
    /** Tick spacing for Slipstream pools (undefined for V2) */
    tickSpacing: z.number().optional(),
    token0: z.object({
      symbol: z.string(),
      address: z.string(),
      decimals: z.number(),
      /** Human-readable reserve (V2) or '0' for Slipstream */
      reserve: z.string(),
      /** Raw reserve value (V2) or '0' for Slipstream */
      reserveRaw: z.string(),
    }),
    token1: z.object({
      symbol: z.string(),
      address: z.string(),
      decimals: z.number(),
      /** Human-readable reserve (V2) or '0' for Slipstream */
      reserve: z.string(),
      /** Raw reserve value (V2) or '0' for Slipstream */
      reserveRaw: z.string(),
    }),
    /** Slipstream-specific: total liquidity in the pool */
    liquidity: z.string().optional(),
    /** Slipstream-specific: current sqrt price (Q96 format) */
    sqrtPriceX96: z.string().optional(),
    /** Slipstream-specific: current tick */
    tick: z.number().optional(),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { tokenA, tokenB } = context

    // Debug: log raw input to catch model hallucinations
    console.log(`  🔍 getPoolMetrics input: tokenA="${tokenA}", tokenB="${tokenB}"`)

    /** Default error response */
    const errorResponse = (
      error: string,
      tokenAMeta?: { symbol: string; address: string; decimals: number },
      tokenBMeta?: { symbol: string; address: string; decimals: number }
    ) => ({
      success: false as const,
      poolAddress: '',
      poolType: 'v2' as PoolType,
      isStable: false,
      token0: {
        symbol: tokenAMeta?.symbol ?? '',
        address: tokenAMeta?.address ?? '',
        decimals: tokenAMeta?.decimals ?? 0,
        reserve: '0',
        reserveRaw: '0',
      },
      token1: {
        symbol: tokenBMeta?.symbol ?? '',
        address: tokenBMeta?.address ?? '',
        decimals: tokenBMeta?.decimals ?? 0,
        reserve: '0',
        reserveRaw: '0',
      },
      error,
    })

    try {
      const tokenAMeta = resolveToken(tokenA)
      const tokenBMeta = resolveToken(tokenB)

      if (!tokenAMeta || !tokenBMeta) {
        const unknownToken = !tokenAMeta ? tokenA : tokenB
        console.error(`  ❌ getPoolMetrics FAILED: Unknown token: ${unknownToken}`)
        return errorResponse(`Unknown token: ${unknownToken}`)
      }

      const provider = getProvider()

      // Dynamically discover the best pool for this pair
      console.log(`  🔍 Discovering pool for ${tokenAMeta.symbol}/${tokenBMeta.symbol}...`)
      const discoveredPool = await discoverBestPool(
        provider,
        tokenAMeta.address,
        tokenBMeta.address
      )

      if (!discoveredPool) {
        console.error(
          `  ❌ getPoolMetrics FAILED: No pool found for ${tokenAMeta.symbol}/${tokenBMeta.symbol}`
        )
        return errorResponse(
          `No pool found for ${tokenAMeta.symbol}/${tokenBMeta.symbol}`,
          tokenAMeta,
          tokenBMeta
        )
      }

      console.log(
        `  📊 Found ${discoveredPool.type} pool at ${discoveredPool.address}` +
          (discoveredPool.tickSpacing ? ` (tick: ${discoveredPool.tickSpacing})` : '') +
          (discoveredPool.stable !== undefined ? ` (stable: ${discoveredPool.stable})` : '')
      )

      // === SLIPSTREAM (CL) POOL ===
      if (discoveredPool.type === 'slipstream') {
        return await fetchSlipstreamPoolData(provider, discoveredPool, tokenAMeta, tokenBMeta)
      }

      // === V2 (CLASSIC AMM) POOL ===
      return await fetchV2PoolData(provider, discoveredPool, tokenAMeta, tokenBMeta)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`  ❌ getPoolMetrics FAILED for ${tokenA}/${tokenB}: ${errorMessage}`)
      return errorResponse(errorMessage)
    }
  },
})

/** Token metadata type */
interface TokenMeta {
  symbol: string
  address: string
  decimals: number
}

/**
 * Fetch data from a Slipstream (CL) pool
 */
async function fetchSlipstreamPoolData(
  provider: ethers.Provider,
  discoveredPool: DiscoveredPool,
  tokenAMeta: TokenMeta,
  tokenBMeta: TokenMeta
) {
  const pool = new ethers.Contract(discoveredPool.address, SLIPSTREAM_POOL_ABI, provider)

  // Get pool state in parallel
  const [token0Address, slot0, liquidity] = await Promise.all([
    pool.token0() as Promise<string>,
    pool.slot0() as Promise<{
      sqrtPriceX96: bigint
      tick: number
      observationIndex: number
      observationCardinality: number
      observationCardinalityNext: number
      unlocked: boolean
    }>,
    pool.liquidity() as Promise<bigint>,
  ])

  // Determine token ordering
  const token0IsA = token0Address.toLowerCase() === tokenAMeta.address.toLowerCase()
  const token0Meta = token0IsA ? tokenAMeta : tokenBMeta
  const token1Meta = token0IsA ? tokenBMeta : tokenAMeta

  return {
    success: true as const,
    poolAddress: discoveredPool.address,
    poolType: 'slipstream' as PoolType,
    isStable: false, // CL pools aren't categorized as stable/volatile
    tickSpacing: discoveredPool.tickSpacing,
    token0: {
      symbol: token0Meta.symbol,
      address: token0Meta.address,
      decimals: token0Meta.decimals,
      reserve: '0', // CL pools don't have traditional reserves
      reserveRaw: '0',
    },
    token1: {
      symbol: token1Meta.symbol,
      address: token1Meta.address,
      decimals: token1Meta.decimals,
      reserve: '0',
      reserveRaw: '0',
    },
    liquidity: liquidity.toString(),
    sqrtPriceX96: slot0.sqrtPriceX96.toString(),
    tick: Number(slot0.tick),
  }
}

/**
 * Fetch data from a V2 (classic AMM) pool
 */
async function fetchV2PoolData(
  provider: ethers.Provider,
  discoveredPool: DiscoveredPool,
  tokenAMeta: TokenMeta,
  tokenBMeta: TokenMeta
) {
  const pool = new ethers.Contract(discoveredPool.address, AERODROME_POOL_ABI, provider)

  // Get reserves and token0 in parallel
  const [reserves, token0Address] = await Promise.all([
    pool.getReserves() as Promise<[bigint, bigint, bigint]>,
    pool.token0() as Promise<string>,
  ])

  const reserve0Raw = reserves[0]
  const reserve1Raw = reserves[1]

  // Determine which token is token0 vs token1
  const token0IsA = token0Address.toLowerCase() === tokenAMeta.address.toLowerCase()
  const token0Meta = token0IsA ? tokenAMeta : tokenBMeta
  const token1Meta = token0IsA ? tokenBMeta : tokenAMeta

  return {
    success: true as const,
    poolAddress: discoveredPool.address,
    poolType: 'v2' as PoolType,
    isStable: discoveredPool.stable ?? false,
    token0: {
      symbol: token0Meta.symbol,
      address: token0Meta.address,
      decimals: token0Meta.decimals,
      reserve: ethers.formatUnits(reserve0Raw, token0Meta.decimals),
      reserveRaw: reserve0Raw.toString(),
    },
    token1: {
      symbol: token1Meta.symbol,
      address: token1Meta.address,
      decimals: token1Meta.decimals,
      reserve: ethers.formatUnits(reserve1Raw, token1Meta.decimals),
      reserveRaw: reserve1Raw.toString(),
    },
  }
}
