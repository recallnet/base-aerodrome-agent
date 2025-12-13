/**
 * Pool Configuration for Aerodrome Trading
 * Maps token pairs to their pool type, address, and parameters
 *
 * Pool Types:
 * - 'slipstream': Concentrated liquidity (CL) pools with 0.05% fee
 * - 'v2': Classic AMM pools with 0.3% fee (volatile) or lower (stable)
 *
 * Most high-liquidity pairs (WETH/USDC, WETH/major tokens) use Slipstream.
 * Meme coins and lower liquidity pairs often use V2.
 */

/** Pool type enum */
export type PoolType = 'slipstream' | 'v2'

/** Pool configuration for a trading pair */
export interface PoolConfig {
  /** Pool type: slipstream (CL) or v2 (classic AMM) */
  type: PoolType
  /** Pool contract address */
  address: `0x${string}`
  /** Tick spacing for Slipstream pools (ignored for V2) */
  tickSpacing?: number
  /** Whether this is a stable pool (for V2 only) */
  stable?: boolean
}

/**
 * Pool configurations indexed by "TOKEN0_TOKEN1" (alphabetically sorted)
 * Use getPoolConfig() to look up - it handles ordering automatically
 */
export const POOL_CONFIGS: Record<string, PoolConfig> = {
  // === Major Pairs (Slipstream CL) ===
  // These have deep liquidity in concentrated liquidity pools

  // WETH/USDC - Main trading pair, tick spacing 100
  USDC_WETH: {
    type: 'slipstream',
    address: '0xd0b53D9277642d899DF5C87A3966A349A798F224',
    tickSpacing: 100,
  },

  // AERO/WETH - Aerodrome native token pair
  AERO_WETH: {
    type: 'slipstream',
    address: '0x7f670f78B17dEC44d5Ef68a48740b6f8849cc2e6',
    tickSpacing: 200,
  },

  // AERO/USDC - Aerodrome token to stablecoin
  AERO_USDC: {
    type: 'slipstream',
    address: '0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d',
    tickSpacing: 200,
  },

  // cbETH/WETH - Coinbase staked ETH (tight range)
  CBETH_WETH: {
    type: 'slipstream',
    address: '0x44Ecc644449fC3a9858d2007CaA8CFAa4C561f91',
    tickSpacing: 1,
  },

  // cbBTC/WETH - Coinbase BTC wrapper
  CBBTH_WETH: {
    type: 'slipstream',
    address: '0x07CdEf99F5Bf5af3A9A8e48D19C5dC99b5E6bf55',
    tickSpacing: 200,
  },

  // VIRTUAL/WETH - AI protocol token
  VIRTUAL_WETH: {
    type: 'slipstream',
    address: '0x6D420B126D74F020E4A47f9067C0cb6E25790bD7',
    tickSpacing: 200,
  },

  // EIGEN/WETH - Restaking token
  EIGEN_WETH: {
    type: 'slipstream',
    address: '0x65EdF95d94de7F6DA45ae8A7B0D85a34c6e9D2B4',
    tickSpacing: 200,
  },

  // === Meme/Community Tokens (V2 AMM) ===
  // These typically have V2 pools with volatile pool type

  // BRETT/WETH - Top meme coin
  BRETT_WETH: {
    type: 'v2',
    address: '0x76Bf0ABd20f1e0155Ce40a62615a90A709a6C3d8',
    stable: false,
  },

  // DEGEN/WETH - Farcaster community token
  DEGEN_WETH: {
    type: 'v2',
    address: '0xC9034c3E7F58003E6ae0C8438e7c8f4598d5ACAA',
    stable: false,
  },

  // TOSHI/WETH - Base native meme coin
  TOSHI_WETH: {
    type: 'v2',
    address: '0x7Fb3c4FF78244c1d52a13e0B4e5d7E54fF4Dac4E',
    stable: false,
  },

  // MIGGLES/WETH - Base meme coin
  MIGGLES_WETH: {
    type: 'v2',
    address: '0x59F5f238416ad7397ACB2E64C39b88AEe1b35E9A',
    stable: false,
  },

  // PONKE/WETH - Base meme coin
  PONKE_WETH: {
    type: 'v2',
    address: '0x8B5D7B3b8c3A2d5f4C6E8a1A9F0e3C7B2D4E6F0A',
    stable: false,
  },

  // === Stablecoin Pairs (V2 Stable) ===
  USDC_USDBC: {
    type: 'v2',
    address: '0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18',
    stable: true,
  },

  DAI_USDC: {
    type: 'v2',
    address: '0x67b00B46FA4f4F24c03855c5C8013C0B938B3eEa',
    stable: true,
  },
}

/**
 * Normalize pool key to ensure consistent ordering
 * Always puts tokens in alphabetical order
 */
function normalizePoolKey(tokenA: string, tokenB: string): string {
  const a = tokenA.toUpperCase()
  const b = tokenB.toUpperCase()
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

/**
 * Get pool configuration for a token pair
 * @param tokenA - First token symbol (e.g., 'WETH', 'USDC')
 * @param tokenB - Second token symbol
 * @returns Pool config or undefined if no configured pool
 */
export function getPoolConfig(tokenA: string, tokenB: string): PoolConfig | undefined {
  const key = normalizePoolKey(tokenA, tokenB)
  return POOL_CONFIGS[key]
}

/**
 * Check if a token pair has a Slipstream (CL) pool
 */
export function isSlipstreamPair(tokenA: string, tokenB: string): boolean {
  const config = getPoolConfig(tokenA, tokenB)
  return config?.type === 'slipstream'
}

/**
 * Get the default tick spacing for a token pair
 * Returns 100 as default for unknown pairs
 */
export function getTickSpacing(tokenA: string, tokenB: string): number {
  const config = getPoolConfig(tokenA, tokenB)
  return config?.tickSpacing ?? 100
}

/**
 * Determine which router to use for a swap
 * Returns 'slipstream' for CL pools, 'v2' for classic AMM
 */
export function getRouterType(tokenA: string, tokenB: string): PoolType {
  const config = getPoolConfig(tokenA, tokenB)
  // Default to V2 if no pool config (safer, more pairs available)
  return config?.type ?? 'v2'
}

/**
 * Check if we should try Slipstream first for a pair
 * Some pairs work better with CL pools even if not explicitly configured
 */
export function shouldPreferSlipstream(tokenA: string, tokenB: string): boolean {
  // Major tokens that typically have CL pools
  const clPreferred = ['WETH', 'USDC', 'AERO', 'CBETH', 'VIRTUAL', 'EIGEN']

  const a = tokenA.toUpperCase()
  const b = tokenB.toUpperCase()

  // If both tokens are in the CL-preferred list, try Slipstream
  const aPreferred = clPreferred.includes(a)
  const bPreferred = clPreferred.includes(b)

  // If explicitly configured, use that
  const config = getPoolConfig(tokenA, tokenB)
  if (config) return config.type === 'slipstream'

  // For WETH pairs with major tokens, prefer Slipstream
  return (a === 'WETH' || b === 'WETH') && (aPreferred || bPreferred)
}
