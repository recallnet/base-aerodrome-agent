/**
 * Trading Diary Repository
 *
 * Key functionality:
 * 1. Log every agent decision (like diary.jsonl in ai-trading-agent)
 * 2. Retrieve recent history for context
 * 3. Update entries with retrospective outcomes
 * 4. Support performance analysis
 */
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'

import { db } from '../db.js'
import {
  eigenaiSignatures,
  portfolioSnapshots,
  priceHistory,
  swapTransactions,
  tradingDiary,
} from '../schema/trading/defs.js'
import type {
  DiaryEntryForContext,
  EigenAISignature,
  NewEigenAISignature,
  NewPortfolioSnapshot,
  NewPriceHistoryEntry,
  NewSwapTransaction,
  NewTradingDiaryEntry,
  PortfolioSnapshot,
  PriceHistoryEntry,
  SwapTransaction,
  TradingDiaryEntry,
} from '../schema/trading/types.js'

export class TradingDiaryRepository {
  /**
   * Log a new diary entry (every agent decision)
   */
  async logDecision(entry: NewTradingDiaryEntry): Promise<TradingDiaryEntry> {
    const [created] = await db.insert(tradingDiary).values(entry).returning()
    return created
  }

  /**
   * Mark a diary entry as executed with transaction hash
   */
  async markExecuted(id: string, txHash: string): Promise<TradingDiaryEntry> {
    const [updated] = await db
      .update(tradingDiary)
      .set({
        executed: true,
        txHash,
        updatedAt: new Date(),
      })
      .where(eq(tradingDiary.id, id))
      .returning()
    return updated
  }

  /**
   * Mark a diary entry as failed
   */
  async markFailed(id: string, error: string): Promise<TradingDiaryEntry> {
    const [updated] = await db
      .update(tradingDiary)
      .set({
        executed: false,
        executionError: error,
        updatedAt: new Date(),
      })
      .where(eq(tradingDiary.id, id))
      .returning()
    return updated
  }

  /**
   * Get recent diary entries for context
   * This is fed back to the agent so it knows what it did before
   */
  async getRecentEntries(limit: number = 20): Promise<DiaryEntryForContext[]> {
    const entries = await db
      .select()
      .from(tradingDiary)
      .orderBy(desc(tradingDiary.timestamp))
      .limit(limit)

    return entries.map((e) => ({
      timestamp: e.timestamp.toISOString(),
      tokenPair: `${e.tokenIn}/${e.tokenOut}`,
      action: e.action,
      amountUsd: e.amountUsd?.toString(),
      priceAtDecision: e.priceAtDecision?.toString(),
      reasoning: e.reasoning,
      executed: e.executed,
      txHash: e.txHash || undefined,
      outcome: e.priceAfter1h
        ? {
            priceAfter1h: e.priceAfter1h?.toString(),
            priceAfter4h: e.priceAfter4h?.toString(),
            priceAfter24h: e.priceAfter24h?.toString(),
            notes: e.outcomeNotes || undefined,
          }
        : undefined,
    }))
  }

  /**
   * Get recent entries for a specific token pair
   */
  async getRecentEntriesForPair(
    tokenIn: string,
    tokenOut: string,
    limit: number = 10
  ): Promise<DiaryEntryForContext[]> {
    const entries = await db
      .select()
      .from(tradingDiary)
      .where(and(eq(tradingDiary.tokenIn, tokenIn), eq(tradingDiary.tokenOut, tokenOut)))
      .orderBy(desc(tradingDiary.timestamp))
      .limit(limit)

    return entries.map((e) => ({
      timestamp: e.timestamp.toISOString(),
      tokenPair: `${e.tokenIn}/${e.tokenOut}`,
      action: e.action,
      amountUsd: e.amountUsd?.toString(),
      priceAtDecision: e.priceAtDecision?.toString(),
      reasoning: e.reasoning,
      executed: e.executed,
      txHash: e.txHash || undefined,
      outcome: e.priceAfter1h
        ? {
            priceAfter1h: e.priceAfter1h?.toString(),
            priceAfter4h: e.priceAfter4h?.toString(),
            priceAfter24h: e.priceAfter24h?.toString(),
            notes: e.outcomeNotes || undefined,
          }
        : undefined,
    }))
  }

  /**
   * Get entries that need retrospective price updates
   * These are entries where we haven't yet recorded what happened after
   */
  async getEntriesNeedingPriceUpdate(
    hoursBack: number,
    field: 'priceAfter1h' | 'priceAfter4h' | 'priceAfter24h'
  ): Promise<TradingDiaryEntry[]> {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000)

    return db
      .select()
      .from(tradingDiary)
      .where(and(lt(tradingDiary.timestamp, cutoffTime), isNull(tradingDiary[field])))
      .orderBy(tradingDiary.timestamp)
      .limit(100)
  }

  /**
   * Update retrospective price data
   */
  async updateRetrospectivePrice(
    id: string,
    field: 'priceAfter1h' | 'priceAfter4h' | 'priceAfter24h',
    price: string
  ): Promise<void> {
    await db
      .update(tradingDiary)
      .set({
        [field]: price,
        updatedAt: new Date(),
      })
      .where(eq(tradingDiary.id, id))
  }

  /**
   * Add outcome notes (agent's retrospective assessment)
   */
  async addOutcomeNotes(id: string, notes: string): Promise<void> {
    await db
      .update(tradingDiary)
      .set({
        outcomeNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(tradingDiary.id, id))
  }

  /**
   * Get executed trades for performance calculation
   */
  async getExecutedTrades(hoursBack: number = 24 * 7): Promise<TradingDiaryEntry[]> {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000)

    return db
      .select()
      .from(tradingDiary)
      .where(and(eq(tradingDiary.executed, true), gt(tradingDiary.timestamp, cutoffTime)))
      .orderBy(desc(tradingDiary.timestamp))
  }

  /**
   * Get daily statistics
   */
  async getDailyStats(date: Date): Promise<{
    totalDecisions: number
    executedTrades: number
    buyDecisions: number
    sellDecisions: number
    holdDecisions: number
  }> {
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

    const result = await db
      .select({
        totalDecisions: sql<number>`count(*)`,
        executedTrades: sql<number>`count(case when executed = true then 1 end)`,
        buyDecisions: sql<number>`count(case when action = 'BUY' then 1 end)`,
        sellDecisions: sql<number>`count(case when action = 'SELL' then 1 end)`,
        holdDecisions: sql<number>`count(case when action = 'HOLD' then 1 end)`,
      })
      .from(tradingDiary)
      .where(and(gt(tradingDiary.timestamp, startOfDay), lt(tradingDiary.timestamp, endOfDay)))

    return (
      result[0] || {
        totalDecisions: 0,
        executedTrades: 0,
        buyDecisions: 0,
        sellDecisions: 0,
        holdDecisions: 0,
      }
    )
  }

  /**
   * Get the current iteration number
   */
  async getCurrentIterationNumber(): Promise<number> {
    const [result] = await db
      .select({ max: sql<number>`coalesce(max(iteration_number), 0)` })
      .from(tradingDiary)
    return result?.max || 0
  }
}

/**
 * Swap Transactions Repository
 */
export class SwapTransactionsRepository {
  async logSwap(swap: NewSwapTransaction): Promise<SwapTransaction> {
    const [created] = await db.insert(swapTransactions).values(swap).returning()
    return created
  }

  async getSwapByTxHash(txHash: string): Promise<SwapTransaction | null> {
    const [result] = await db
      .select()
      .from(swapTransactions)
      .where(eq(swapTransactions.txHash, txHash))
      .limit(1)
    return result || null
  }

  async getRecentSwaps(limit: number = 20): Promise<SwapTransaction[]> {
    return db.select().from(swapTransactions).orderBy(desc(swapTransactions.timestamp)).limit(limit)
  }
}

/**
 * Portfolio Snapshots Repository
 */
export class PortfolioSnapshotsRepository {
  async createSnapshot(snapshot: NewPortfolioSnapshot): Promise<PortfolioSnapshot> {
    const [created] = await db.insert(portfolioSnapshots).values(snapshot).returning()
    return created
  }

  async getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    const [result] = await db
      .select()
      .from(portfolioSnapshots)
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(1)
    return result || null
  }

  async getSnapshotHistory(limit: number = 100): Promise<PortfolioSnapshot[]> {
    return db
      .select()
      .from(portfolioSnapshots)
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(limit)
  }
}

/**
 * Price History Repository
 */
export class PriceHistoryRepository {
  async recordPrice(entry: NewPriceHistoryEntry): Promise<PriceHistoryEntry> {
    const [created] = await db.insert(priceHistory).values(entry).returning()
    return created
  }

  async getPrice(token: string, timestamp: Date): Promise<PriceHistoryEntry | null> {
    // Get closest price to the requested timestamp
    const [result] = await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.token, token),
          lt(priceHistory.timestamp, new Date(timestamp.getTime() + 5 * 60 * 1000)) // Within 5 min
        )
      )
      .orderBy(desc(priceHistory.timestamp))
      .limit(1)
    return result || null
  }

  async getRecentPrices(token: string, limit: number = 100): Promise<PriceHistoryEntry[]> {
    return db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.token, token))
      .orderBy(desc(priceHistory.timestamp))
      .limit(limit)
  }
}

/**
 * EigenAI Signatures Repository
 * Records cryptographic signatures from EigenAI for verifiable inference
 */
export class EigenAISignaturesRepository {
  /**
   * Store a new signature record
   */
  async createSignature(signature: NewEigenAISignature): Promise<EigenAISignature> {
    const [created] = await db.insert(eigenaiSignatures).values(signature).returning()
    return created
  }

  /**
   * Get signature by iteration number
   */
  async getByIteration(iterationNumber: number): Promise<EigenAISignature | null> {
    const [result] = await db
      .select()
      .from(eigenaiSignatures)
      .where(eq(eigenaiSignatures.iterationNumber, iterationNumber))
      .limit(1)
    return result || null
  }

  /**
   * Get signatures pending Recall submission
   */
  async getPendingRecallSubmission(limit: number = 10): Promise<EigenAISignature[]> {
    return db
      .select()
      .from(eigenaiSignatures)
      .where(
        and(
          eq(eigenaiSignatures.submittedToRecall, false),
          eq(eigenaiSignatures.localVerificationStatus, 'verified')
        )
      )
      .orderBy(eigenaiSignatures.timestamp)
      .limit(limit)
  }

  /**
   * Mark signature as submitted to Recall
   */
  async markSubmittedToRecall(
    id: string,
    recallSubmissionId: string
  ): Promise<EigenAISignature> {
    const [updated] = await db
      .update(eigenaiSignatures)
      .set({
        submittedToRecall: true,
        recallSubmissionId,
        recallSubmittedAt: new Date(),
        recallVerificationStatus: 'pending',
        updatedAt: new Date(),
      })
      .where(eq(eigenaiSignatures.id, id))
      .returning()
    return updated
  }

  /**
   * Update Recall verification status
   */
  async updateRecallStatus(
    id: string,
    status: 'verified' | 'rejected' | 'error',
    error?: string
  ): Promise<EigenAISignature> {
    const [updated] = await db
      .update(eigenaiSignatures)
      .set({
        recallVerificationStatus: status,
        recallError: error,
        updatedAt: new Date(),
      })
      .where(eq(eigenaiSignatures.id, id))
      .returning()
    return updated
  }

  /**
   * Get recent signatures for monitoring
   */
  async getRecent(limit: number = 20): Promise<EigenAISignature[]> {
    return db
      .select()
      .from(eigenaiSignatures)
      .orderBy(desc(eigenaiSignatures.timestamp))
      .limit(limit)
  }

  /**
   * Get signature statistics
   */
  async getStats(): Promise<{
    total: number
    verified: number
    invalid: number
    submittedToRecall: number
  }> {
    const result = await db
      .select({
        total: sql<number>`count(*)`,
        verified: sql<number>`count(case when local_verification_status = 'verified' then 1 end)`,
        invalid: sql<number>`count(case when local_verification_status = 'invalid' then 1 end)`,
        submittedToRecall: sql<number>`count(case when submitted_to_recall = true then 1 end)`,
      })
      .from(eigenaiSignatures)

    return (
      result[0] || {
        total: 0,
        verified: 0,
        invalid: 0,
        submittedToRecall: 0,
      }
    )
  }
}

// Singleton instances
export const tradingDiaryRepo = new TradingDiaryRepository()
export const swapTransactionsRepo = new SwapTransactionsRepository()
export const portfolioSnapshotsRepo = new PortfolioSnapshotsRepository()
export const priceHistoryRepo = new PriceHistoryRepository()
export const eigenaiSignaturesRepo = new EigenAISignaturesRepository()
