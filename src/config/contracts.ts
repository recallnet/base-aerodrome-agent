/**
 * Aerodrome Contract Configuration for Base Chain
 * Contains contract addresses and ABIs for DEX interactions
 *
 * Aerodrome supports two pool types:
 * - V2 (Classic AMM): Traditional x*y=k pools with 0.3% fee
 * - Slipstream (CL): Concentrated liquidity (Uni V3-style) with 0.05% fee
 */

/** Aerodrome contract addresses on Base mainnet */
export const AERODROME_CONTRACTS = {
  // === V2 (Classic AMM) ===
  /** Router V2 - Main entry point for classic AMM swaps */
  ROUTER_V2: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  /** Pool Factory for volatile pairs (V2) */
  POOL_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',

  // === Slipstream (Concentrated Liquidity) ===
  /** Slipstream Swap Router - Entry point for CL swaps */
  SLIPSTREAM_ROUTER: '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5',
  /** Slipstream Factory - Creates CL pools */
  SLIPSTREAM_FACTORY: '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A',

  // === Other ===
  /** Universal Router - Advanced routing */
  UNIVERSAL_ROUTER: '0x6Cb442acF35158D5eDa88fe602221b67B400bE3E',
  /** Voter contract for gauge management */
  VOTER: '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5',
} as const

/** Base chain configuration */
export const BASE_CHAIN = {
  chainId: 8453,
  name: 'Base',
  rpcUrl: 'https://mainnet.base.org',
  blockExplorer: 'https://basescan.org',
} as const

/** Minimal ABI for ERC20 tokens */
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
] as const

/**
 * Aerodrome Router V2 ABI (minimal for swaps)
 * @see https://basescan.org/address/0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43
 */
export const AERODROME_ROUTER_ABI = [
  // Read functions
  'function getAmountsOut(uint amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint[] amounts)',
  'function getReserves(address tokenA, address tokenB, bool stable, address factory) view returns (uint reserveA, uint reserveB)',
  'function poolFor(address tokenA, address tokenB, bool stable, address factory) view returns (address pool)',
  'function factory() view returns (address)',
  'function defaultFactory() view returns (address)',
  'function ETHER() view returns (address)',
  'function weth() view returns (address)',

  // Write functions - Token to Token
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline)',

  // Write functions - ETH to Token
  'function swapExactETHForTokens(uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) payable',

  // Write functions - Token to ETH
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline)',
] as const

/**
 * Aerodrome V2 Pool ABI (for getting pool info - classic AMM)
 */
export const AERODROME_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function reserve0() view returns (uint256)',
  'function reserve1() view returns (uint256)',
  'function stable() view returns (bool)',
  'function getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function factory() view returns (address)',
  'function metadata() view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, bool st, address t0, address t1)',
] as const

/**
 * Slipstream (CL) Pool ABI - Uniswap V3 style concentrated liquidity
 * Uses sqrtPriceX96 encoding for price (like Uni V3)
 */
export const SLIPSTREAM_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)',
  'function tickSpacing() view returns (int24)',
] as const

/**
 * Slipstream Swap Router ABI - for executing CL swaps
 * Uses exactInputSingle for single-hop swaps
 */
export const SLIPSTREAM_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, int24 tickSpacing, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
] as const

/**
 * Slipstream CLFactory ABI - for discovering CL pools
 * getPool returns a deterministic CREATE2 address - use isPool() to verify it's deployed
 */
export const SLIPSTREAM_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address pool)',
  'function isPool(address pool) view returns (bool)',
  'function implementation() view returns (address)',
] as const

/**
 * V2 Pool Factory ABI - for discovering classic AMM pools
 * getPool returns the pool address for a token pair + stability type (or zero address if none)
 */
export const V2_POOL_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) view returns (address pool)',
  'function allPoolsLength() view returns (uint256)',
  'function isPaused() view returns (bool)',
] as const

/**
 * Route struct for Aerodrome swaps
 * Matches the Solidity struct:
 * struct Route {
 *   address from;      // Input token address
 *   address to;        // Output token address
 *   bool stable;       // true for stable pools, false for volatile pools
 *   address factory;   // Pool factory address (optional, can be address(0))
 * }
 */
export interface AerodromeRoute {
  from: string
  to: string
  stable: boolean
  factory: string
}

/**
 * Create a route for Aerodrome swap
 * @param from - Input token address
 * @param to - Output token address
 * @param stable - Whether to use stable pool (for stablecoin pairs)
 * @param factory - Factory address (use zero address for default)
 */
export function createRoute(
  from: string,
  to: string,
  stable: boolean,
  factory: string = '0x0000000000000000000000000000000000000000'
): AerodromeRoute {
  return { from, to, stable, factory }
}
