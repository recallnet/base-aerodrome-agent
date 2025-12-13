import { DEFAULT_TRADING_PAIRS } from './tokens.js'

/**
 * Configuration exports for Aerodrome Trading Agent
 */

export * from './tokens.js'
export * from './contracts.js'
export * from './pools.js'

/** Trading pair structure */
export interface TradingPair {
  base: string
  quote: string
}

/**
 * Parse trading pairs from environment variable
 *
 * Supports formats:
 * - "WETH/USDC,AERO/USDC" (comma-separated)
 * - "WETH/USDC AERO/USDC" (space-separated)
 *
 * @returns Parsed trading pairs or default pairs if not set
 */
export function getTradingPairs(): TradingPair[] {
  const envPairs = process.env.TRADING_PAIRS

  if (!envPairs || envPairs.trim() === '') {
    return [...DEFAULT_TRADING_PAIRS]
  }

  // Support both comma and space separators
  const separator = envPairs.includes(',') ? ',' : ' '
  const pairStrings = envPairs.split(separator).filter((s) => s.trim())

  const pairs: TradingPair[] = []
  for (const pairStr of pairStrings) {
    const trimmed = pairStr.trim()
    if (!trimmed.includes('/')) {
      console.warn(
        `[Config] Invalid pair format "${trimmed}" - expected "QUOTE/BASE" (e.g., "WETH/USDC")`
      )
      continue
    }

    const [quote, base] = trimmed.split('/')
    if (!quote || !base) {
      console.warn(`[Config] Invalid pair "${trimmed}" - both quote and base required`)
      continue
    }

    pairs.push({
      quote: quote.trim().toUpperCase(),
      base: base.trim().toUpperCase(),
    })
  }

  if (pairs.length === 0) {
    console.warn('[Config] No valid pairs parsed from TRADING_PAIRS, using defaults')
    return [...DEFAULT_TRADING_PAIRS]
  }

  console.log(`[Config] Loaded ${pairs.length} trading pairs from environment`)
  return pairs
}

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
 * CoinGecko API key for technical indicators
 */
export const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''

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

/**
 * Recall API configuration
 *
 * Used for submitting EigenAI verified signatures.
 * Required environment variables:
 * - RECALL_API_URL: Base URL for the Recall API (e.g., "https://api.recall.example.com")
 * - RECALL_API_KEY: Agent API key for authentication
 * - RECALL_COMPETITION_ID: Competition UUID the agent is participating in
 */
export const RECALL_CONFIG = {
  /** Recall API base URL */
  apiUrl: process.env.RECALL_API_URL ?? '',
  /** Recall API key for agent authentication */
  apiKey: process.env.RECALL_API_KEY ?? '',
  /** Competition ID for signature submissions */
  competitionId: process.env.RECALL_COMPETITION_ID ?? '',
  /** Submission interval in milliseconds (15 minutes) */
  submissionIntervalMs: 15 * 60 * 1000,
} as const
