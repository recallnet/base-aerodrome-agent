/**
 * TypeScript types derived from Drizzle schema
 */
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import type {
  eigenaiSignatures,
  portfolioSnapshots,
  positions,
  priceHistory,
  swapTransactions,
  tradingDiary,
} from './defs.js'

// Trading Diary
export type TradingDiaryEntry = InferSelectModel<typeof tradingDiary>
export type NewTradingDiaryEntry = InferInsertModel<typeof tradingDiary>

// Swap Transactions
export type SwapTransaction = InferSelectModel<typeof swapTransactions>
export type NewSwapTransaction = InferInsertModel<typeof swapTransactions>

// Portfolio Snapshots
export type PortfolioSnapshot = InferSelectModel<typeof portfolioSnapshots>
export type NewPortfolioSnapshot = InferInsertModel<typeof portfolioSnapshots>

// Price History
export type PriceHistoryEntry = InferSelectModel<typeof priceHistory>
export type NewPriceHistoryEntry = InferInsertModel<typeof priceHistory>

// Positions
export type Position = InferSelectModel<typeof positions>
export type NewPosition = InferInsertModel<typeof positions>

// EigenAI Signatures
export type EigenAISignature = InferSelectModel<typeof eigenaiSignatures>
export type NewEigenAISignature = InferInsertModel<typeof eigenaiSignatures>

/**
 * Context snapshot stored with each diary entry
 * This is what the agent saw when making the decision
 */
export interface ContextSnapshot {
  wallet?: {
    balances: Record<string, string>
    totalValueUsd?: string
  }
  prices?: Record<
    string,
    {
      usd: string
      change24h?: number
    }
  >
  pool?: {
    address: string
    reserves: Record<string, string>
    isStable: boolean
  }
  sentiment?: Record<string, unknown>
  quote?: {
    amountIn: string
    amountOut: string
    priceImpact?: string
  }
}

/**
 * Formatted diary entry for feeding back to agent context
 */
export interface DiaryEntryForContext {
  timestamp: string
  tokenPair: string
  action: string
  amountUsd?: string
  priceAtDecision?: string
  reasoning: string
  executed: boolean
  txHash?: string
  // Retrospective data if available
  outcome?: {
    priceAfter1h?: string
    priceAfter4h?: string
    priceAfter24h?: string
    notes?: string
  }
}
