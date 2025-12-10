/**
 * Configuration exports for Aerodrome Trading Agent
 */

export * from './tokens.js'
export * from './contracts.js'
export * from './eigenai.js'

/**
 * Environment configuration
 * DRY_RUN=true prevents ANY actual trades from being executed
 */
export const ENV_CONFIG = {
  /** When true, all trades are simulated (no real transactions) */
  dryRun: process.env.DRY_RUN === 'true' || process.env.TEST_MODE === 'true',
  /** Environment mode */
  nodeEnv: process.env.NODE_ENV || 'development',
  /** Is this a test environment? */
  isTest: process.env.NODE_ENV === 'test',
} as const

/**
 * CoinGecko API configuration
 * Supports both Pro (paid) and Demo (free) API tiers
 * Pro API key takes precedence if both are set
 *
 * @returns Config object if an API key is set, null otherwise
 */
export function getCoinGeckoConfig(): {
  apiKey: string
  baseUrl: string
  headerName: string
  tier: 'pro' | 'demo'
} | null {
  const proKey = process.env.COINGECKO_PRO_API_KEY
  const demoKey = process.env.COINGECKO_DEMO_API_KEY

  if (proKey) {
    return {
      apiKey: proKey,
      baseUrl: 'https://pro-api.coingecko.com/api/v3',
      headerName: 'x-cg-pro-api-key',
      tier: 'pro',
    }
  }

  if (demoKey) {
    return {
      apiKey: demoKey,
      baseUrl: 'https://api.coingecko.com/api/v3',
      headerName: 'x-cg-demo-api-key',
      tier: 'demo',
    }
  }

  return null
}

/**
 * Risk management configuration
 * These limits help prevent excessive losses
 */
export const RISK_CONFIG = {
  /** Maximum USD value for a single trade */
  maxSingleTradeUsd: 100,
  /** Maximum total portfolio exposure in USD */
  maxTotalExposureUsd: 500,
  /** Maximum percentage of balance to risk on a single trade */
  maxTradePercentage: 10,
  /** Minimum confidence required to execute a trade (0-100) */
  minConfidenceThreshold: 70,
  /** Maximum acceptable price impact percentage */
  maxPriceImpactPercent: 1.0,
  /** Default slippage tolerance percentage */
  defaultSlippagePercent: 0.5,
  /** Maximum slippage tolerance percentage */
  maxSlippagePercent: 3.0,
} as const

/**
 * Trading interval configuration
 */
export const TRADING_CONFIG = {
  /** Interval between trading iterations in milliseconds (5 minutes) */
  iterationIntervalMs: 5 * 60 * 1000,
  /** Maximum tool calling steps for agent iteration */
  maxAgentSteps: 20,
  /** Transaction deadline in seconds from now */
  txDeadlineSeconds: 30 * 60, // 30 minutes
} as const

/**
 * API configuration
 */
export const API_CONFIG = {
  /** CoinGecko API base URL */
  coingeckoBaseUrl: 'https://api.coingecko.com/api/v3',
  /** DexScreener API base URL */
  dexScreenerBaseUrl: 'https://api.dexscreener.com/latest',
  /** Base chain RPC URL (fallback if not in env) */
  defaultRpcUrl: 'https://mainnet.base.org',
} as const
