/**
 * Dynamic Pool Discovery for Aerodrome
 *
 * Discovers pool addresses on-chain using Factory contracts instead of hardcoding.
 * Supports both Slipstream (CL) and V2 (classic AMM) pools.
 *
 * Flow:
 * 1. Try Slipstream pools first (if token pair likely has CL liquidity)
 * 2. Fall back to V2 volatile pools
 * 3. Fall back to V2 stable pools (for stablecoin pairs)
 */
import { ethers } from 'ethers'

import { AERODROME_CONTRACTS, SLIPSTREAM_FACTORY_ABI, V2_POOL_FACTORY_ABI } from './contracts'
import type { PoolType } from './pools'

/** Standard tick spacings to try for Slipstream pools */
export const SLIPSTREAM_TICK_SPACINGS = [1, 50, 100, 200] as const

/** Zero address constant */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Minimal ABI to validate pool responds to V3-style calls */
const SLIPSTREAM_VALIDATION_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)',
] as const

/**
 * Validate that a Slipstream pool responds to our V3-style ABI
 * Some deployed pools may have different implementations
 */
async function validateSlipstreamPoolABI(
  provider: ethers.Provider,
  poolAddress: string
): Promise<boolean> {
  try {
    const pool = new ethers.Contract(poolAddress, SLIPSTREAM_VALIDATION_ABI, provider)
    await pool.slot0()
    return true
  } catch {
    return false
  }
}

/** Result of pool discovery */
export interface DiscoveredPool {
  /** Pool contract address */
  address: `0x${string}`
  /** Pool type */
  type: PoolType
  /** Tick spacing (for Slipstream pools) */
  tickSpacing?: number
  /** Whether stable pool (for V2 pools) */
  stable?: boolean
}

/**
 * Discover a Slipstream (CL) pool for a token pair
 * Tries common tick spacings and returns the first valid pool found
 *
 * NOTE: CLFactory.getPool() returns a deterministic CREATE2 address even if the pool
 * hasn't been deployed yet. We use isPool() to verify the pool actually exists.
 *
 * @param provider - Ethers provider
 * @param tokenA - First token address
 * @param tokenB - Second token address
 * @param preferredTickSpacing - Optional preferred tick spacing to try first
 * @returns Pool info or null if no pool exists
 */
export async function discoverSlipstreamPool(
  provider: ethers.Provider,
  tokenA: string,
  tokenB: string,
  preferredTickSpacing?: number
): Promise<DiscoveredPool | null> {
  const factory = new ethers.Contract(
    AERODROME_CONTRACTS.SLIPSTREAM_FACTORY,
    SLIPSTREAM_FACTORY_ABI,
    provider
  )

  // Order tick spacings with preferred first
  const tickSpacingsToTry = preferredTickSpacing
    ? [preferredTickSpacing, ...SLIPSTREAM_TICK_SPACINGS.filter((t) => t !== preferredTickSpacing)]
    : [...SLIPSTREAM_TICK_SPACINGS]

  for (const tickSpacing of tickSpacingsToTry) {
    try {
      const poolAddress = (await factory.getPool(tokenA, tokenB, tickSpacing)) as string
      if (poolAddress && poolAddress !== ZERO_ADDRESS) {
        // IMPORTANT: getPool returns deterministic CREATE2 address even if not deployed
        // Verify the pool is actually deployed with isPool()
        const isDeployed = (await factory.isPool(poolAddress)) as boolean
        if (isDeployed) {
          // ALSO verify the pool responds to our V3-style ABI
          // Some deployed pools may have different implementations
          const isCompatible = await validateSlipstreamPoolABI(provider, poolAddress)
          if (isCompatible) {
            return {
              address: poolAddress as `0x${string}`,
              type: 'slipstream',
              tickSpacing,
            }
          }
          // Pool deployed but not V3-compatible, try next tick spacing
        }
        // Pool address exists but not actually deployed, try next tick spacing
      }
    } catch {
      // Pool doesn't exist for this tick spacing, continue
    }
  }

  return null
}

/**
 * Discover a V2 (classic AMM) pool for a token pair
 *
 * @param provider - Ethers provider
 * @param tokenA - First token address
 * @param tokenB - Second token address
 * @param preferStable - Whether to try stable pool first
 * @returns Pool info or null if no pool exists
 */
export async function discoverV2Pool(
  provider: ethers.Provider,
  tokenA: string,
  tokenB: string,
  preferStable: boolean = false
): Promise<DiscoveredPool | null> {
  const factory = new ethers.Contract(
    AERODROME_CONTRACTS.POOL_FACTORY,
    V2_POOL_FACTORY_ABI,
    provider
  )

  // Try in order: preferred stability type first, then the other
  const stabilityTypes = preferStable ? [true, false] : [false, true]

  for (const stable of stabilityTypes) {
    try {
      const poolAddress = (await factory.getPool(tokenA, tokenB, stable)) as string
      if (poolAddress && poolAddress !== ZERO_ADDRESS) {
        return {
          address: poolAddress as `0x${string}`,
          type: 'v2',
          stable,
        }
      }
    } catch {
      // Pool doesn't exist for this stability type, continue
    }
  }

  return null
}

/**
 * Discover the best pool for a token pair
 *
 * Strategy:
 * 1. Try Slipstream first (lower fees at 0.05% vs 0.3%)
 * 2. Fall back to V2 volatile pools
 * 3. Fall back to V2 stable pools
 *
 * No hardcoded token lists - purely on-chain discovery.
 *
 * @param provider - Ethers provider
 * @param tokenA - First token address
 * @param tokenB - Second token address
 * @returns Best pool found or null if none exists
 */
export async function discoverBestPool(
  provider: ethers.Provider,
  tokenA: string,
  tokenB: string
): Promise<DiscoveredPool | null> {
  // Try Slipstream first - lower fees (0.05% vs 0.3%)
  const slipstream = await discoverSlipstreamPool(provider, tokenA, tokenB)
  if (slipstream) return slipstream

  // Fall back to V2 (tries volatile first, then stable)
  const v2 = await discoverV2Pool(provider, tokenA, tokenB, false)
  if (v2) return v2

  return null
}

/**
 * Discover all available pools for a token pair
 * Returns all valid pools found (useful for comparing routes)
 *
 * @param provider - Ethers provider
 * @param tokenA - First token address
 * @param tokenB - Second token address
 * @returns Array of all discovered pools
 */
export async function discoverAllPools(
  provider: ethers.Provider,
  tokenA: string,
  tokenB: string
): Promise<DiscoveredPool[]> {
  const pools: DiscoveredPool[] = []

  // Try all Slipstream tick spacings
  const slipstreamFactory = new ethers.Contract(
    AERODROME_CONTRACTS.SLIPSTREAM_FACTORY,
    SLIPSTREAM_FACTORY_ABI,
    provider
  )
  const slipstreamPromises = SLIPSTREAM_TICK_SPACINGS.map(async (tickSpacing) => {
    try {
      const poolAddress = (await slipstreamFactory.getPool(tokenA, tokenB, tickSpacing)) as string
      if (poolAddress && poolAddress !== ZERO_ADDRESS) {
        // Verify the pool is actually deployed
        const isDeployed = (await slipstreamFactory.isPool(poolAddress)) as boolean
        if (isDeployed) {
          // Also verify ABI compatibility
          const isCompatible = await validateSlipstreamPoolABI(provider, poolAddress)
          if (isCompatible) {
            return {
              address: poolAddress as `0x${string}`,
              type: 'slipstream' as const,
              tickSpacing,
            }
          }
        }
      }
    } catch {
      // Pool doesn't exist
    }
    return null
  })

  // Try both V2 pool types
  const v2Factory = new ethers.Contract(
    AERODROME_CONTRACTS.POOL_FACTORY,
    V2_POOL_FACTORY_ABI,
    provider
  )

  const v2Promises = [true, false].map(async (stable) => {
    try {
      const poolAddress = (await v2Factory.getPool(tokenA, tokenB, stable)) as string
      if (poolAddress && poolAddress !== ZERO_ADDRESS) {
        return {
          address: poolAddress as `0x${string}`,
          type: 'v2' as const,
          stable,
        }
      }
    } catch {
      // Pool doesn't exist
    }
    return null
  })

  const results = await Promise.all([...slipstreamPromises, ...v2Promises])
  for (const result of results) {
    if (result) pools.push(result)
  }

  return pools
}
