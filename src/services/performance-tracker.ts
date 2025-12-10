/**
 * Portfolio Performance Tracker
 *
 * Tracks:
 * - Position cost basis (average cost method)
 * - Realized P&L from closed trades
 * - Unrealized P&L from current positions
 * - Win rate and trade statistics
 * - Portfolio value over time
 */
import { and, desc, eq, gt } from 'drizzle-orm'

import { db } from '../database/db.js'
import { portfolioSnapshots, positions, swapTransactions } from '../database/schema/trading/defs.js'
import type {
  NewPortfolioSnapshot,
  NewPosition,
  PortfolioSnapshot,
  Position,
} from '../database/schema/trading/types.js'

/**
 * Performance metrics summary
 */
export interface PerformanceMetrics {
  /** Current portfolio value in USD */
  currentValueUsd: number
  /** Starting value (first snapshot) in USD */
  startingValueUsd: number
  /** Total P&L in USD (realized + unrealized) */
  totalPnlUsd: number
  /** Total P&L as percentage */
  totalPnlPercent: number
  /** Realized P&L from closed trades */
  realizedPnlUsd: number
  /** Unrealized P&L from open positions */
  unrealizedPnlUsd: number
  /** Number of winning trades */
  winningTrades: number
  /** Number of losing trades */
  losingTrades: number
  /** Win rate as percentage */
  winRate: number
  /** Total number of trades executed */
  totalTrades: number
  /** Average trade size in USD */
  avgTradeSizeUsd: number
  /** Best trade P&L in USD */
  bestTradeUsd: number
  /** Worst trade P&L in USD */
  worstTradeUsd: number
  /** Total gas spent in USD */
  totalGasSpentUsd: number
  /** Timeframe of the metrics */
  timeframe: {
    start: string
    end: string
    daysActive: number
  }
}

/**
 * Position with current market value
 */
export interface PositionWithValue extends Position {
  currentPriceUsd: number
  currentValueUsd: number
  unrealizedPnlUsd: number
  unrealizedPnlPercent: number
}

export class PerformanceTracker {
  /**
   * Record a buy trade - updates position cost basis
   */
  async recordBuy(
    token: string,
    tokenAddress: string,
    amount: number,
    costUsd: number
  ): Promise<Position> {
    // Get or create position
    const position = await this.getPosition(token)

    if (!position) {
      // Create new position
      const newPosition: NewPosition = {
        token,
        tokenAddress,
        balance: amount.toString(),
        totalCostUsd: costUsd.toFixed(2),
        averageCostPerToken: (costUsd / amount).toString(),
        totalBought: amount.toString(),
        totalBuyCostUsd: costUsd.toFixed(2),
        buyCount: 1,
        firstTradeAt: new Date(),
        lastTradeAt: new Date(),
      }
      const [created] = await db.insert(positions).values(newPosition).returning()
      return created
    }

    // Update existing position with new average cost
    const currentBalance = parseFloat(position.balance)
    const currentTotalCost = parseFloat(position.totalCostUsd)
    const newBalance = currentBalance + amount
    const newTotalCost = currentTotalCost + costUsd
    const newAvgCost = newTotalCost / newBalance

    const [updated] = await db
      .update(positions)
      .set({
        balance: newBalance.toString(),
        totalCostUsd: newTotalCost.toFixed(2),
        averageCostPerToken: newAvgCost.toString(),
        totalBought: (parseFloat(position.totalBought) + amount).toString(),
        totalBuyCostUsd: (parseFloat(position.totalBuyCostUsd) + costUsd).toFixed(2),
        buyCount: position.buyCount + 1,
        lastTradeAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(positions.token, token))
      .returning()

    return updated
  }

  /**
   * Record a sell trade - realizes P&L based on average cost
   *
   * Returns null if no position exists (token was acquired outside the tracking system).
   * In this case, the sale is still logged to swap_transactions, but P&L cannot be calculated.
   */
  async recordSell(
    token: string,
    amount: number,
    proceedsUsd: number
  ): Promise<{ position: Position; realizedPnl: number } | null> {
    const position = await this.getPosition(token)

    // Skip P&L tracking for tokens acquired outside the tracking system
    if (!position) {
      console.log(
        `⚠️ Skipping P&L tracking for ${token} - no cost basis data (token acquired outside system)`
      )
      return null
    }

    const currentBalance = parseFloat(position.balance)
    if (amount > currentBalance) {
      throw new Error(
        `Insufficient balance: trying to sell ${amount} but only have ${currentBalance}`
      )
    }

    // Calculate realized P&L using average cost method
    const avgCost = parseFloat(position.averageCostPerToken || '0')
    const costBasis = avgCost * amount
    const realizedPnl = proceedsUsd - costBasis

    // Update position
    const newBalance = currentBalance - amount
    const newTotalCost = newBalance * avgCost // Remaining cost basis

    const [updated] = await db
      .update(positions)
      .set({
        balance: newBalance.toString(),
        totalCostUsd: newTotalCost.toFixed(2),
        // Average cost remains the same for remaining tokens
        totalSold: (parseFloat(position.totalSold) + amount).toString(),
        totalSellProceedsUsd: (parseFloat(position.totalSellProceedsUsd) + proceedsUsd).toFixed(2),
        realizedPnlUsd: (parseFloat(position.realizedPnlUsd) + realizedPnl).toFixed(2),
        sellCount: position.sellCount + 1,
        lastTradeAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(positions.token, token))
      .returning()

    return { position: updated, realizedPnl }
  }

  /**
   * Get a position by token symbol
   */
  async getPosition(token: string): Promise<Position | null> {
    const [result] = await db
      .select()
      .from(positions)
      .where(eq(positions.token, token.toUpperCase()))
      .limit(1)
    return result || null
  }

  /**
   * Get all positions with non-zero balance
   */
  async getAllPositions(): Promise<Position[]> {
    return db
      .select()
      .from(positions)
      .where(gt(positions.balance, '0'))
      .orderBy(desc(positions.balance))
  }

  /**
   * Get positions with current market values
   * @param getCurrentPrice Function to fetch current price for a token
   */
  async getPositionsWithValues(
    getCurrentPrice: (token: string) => Promise<number>
  ): Promise<PositionWithValue[]> {
    const allPositions = await this.getAllPositions()
    const result: PositionWithValue[] = []

    for (const pos of allPositions) {
      const balance = parseFloat(pos.balance)
      if (balance <= 0) continue

      const currentPriceUsd = await getCurrentPrice(pos.token)
      const currentValueUsd = balance * currentPriceUsd
      const costBasis = parseFloat(pos.totalCostUsd)
      const unrealizedPnlUsd = currentValueUsd - costBasis
      const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnlUsd / costBasis) * 100 : 0

      result.push({
        ...pos,
        currentPriceUsd,
        currentValueUsd,
        unrealizedPnlUsd,
        unrealizedPnlPercent,
      })
    }

    return result
  }

  /**
   * Create a portfolio snapshot
   */
  async createSnapshot(
    balances: Record<string, string>,
    totalValueUsd: number,
    iterationNumber?: number
  ): Promise<PortfolioSnapshot> {
    // Get starting value from first snapshot
    const firstSnapshot = await this.getFirstSnapshot()
    const startingValueUsd = firstSnapshot
      ? parseFloat(firstSnapshot.totalValueUsd || '0')
      : totalValueUsd

    const pnlUsd = totalValueUsd - startingValueUsd
    const pnlPercent = startingValueUsd > 0 ? (pnlUsd / startingValueUsd) * 100 : 0

    const snapshot: NewPortfolioSnapshot = {
      balances,
      totalValueUsd: totalValueUsd.toFixed(2),
      startingValueUsd: startingValueUsd.toFixed(2),
      pnlUsd: pnlUsd.toFixed(2),
      pnlPercent: pnlPercent.toFixed(4),
      iterationNumber,
    }

    const [created] = await db.insert(portfolioSnapshots).values(snapshot).returning()
    return created
  }

  /**
   * Get the first portfolio snapshot (for starting value)
   */
  async getFirstSnapshot(): Promise<PortfolioSnapshot | null> {
    const [result] = await db
      .select()
      .from(portfolioSnapshots)
      .orderBy(portfolioSnapshots.timestamp)
      .limit(1)
    return result || null
  }

  /**
   * Get the latest portfolio snapshot
   */
  async getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    const [result] = await db
      .select()
      .from(portfolioSnapshots)
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(1)
    return result || null
  }

  /**
   * Get portfolio value history
   */
  async getValueHistory(limit: number = 100): Promise<PortfolioSnapshot[]> {
    return db
      .select()
      .from(portfolioSnapshots)
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(limit)
  }

  /**
   * Calculate comprehensive performance metrics
   */
  async getPerformanceMetrics(
    getCurrentPrice: (token: string) => Promise<number>,
    hoursBack: number = 24 * 30 // Default: 30 days
  ): Promise<PerformanceMetrics> {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000)

    // Get all positions with values
    const positionsWithValues = await this.getPositionsWithValues(getCurrentPrice)

    // Calculate current portfolio value
    const currentValueUsd = positionsWithValues.reduce((sum, pos) => sum + pos.currentValueUsd, 0)

    // Get first snapshot for starting value
    const firstSnapshot = await this.getFirstSnapshot()

    const startingValueUsd = firstSnapshot
      ? parseFloat(firstSnapshot.totalValueUsd || '0')
      : currentValueUsd

    // Calculate P&L
    const realizedPnlUsd = positionsWithValues.reduce(
      (sum, pos) => sum + parseFloat(pos.realizedPnlUsd),
      0
    )

    const unrealizedPnlUsd = positionsWithValues.reduce((sum, pos) => sum + pos.unrealizedPnlUsd, 0)

    const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd
    const totalPnlPercent = startingValueUsd > 0 ? (totalPnlUsd / startingValueUsd) * 100 : 0

    // Get trade statistics from swap transactions
    const trades = await db
      .select()
      .from(swapTransactions)
      .where(
        and(gt(swapTransactions.timestamp, cutoffTime), eq(swapTransactions.status, 'SUCCESS'))
      )

    const totalTrades = trades.length
    const totalGasSpentUsd = trades.reduce((sum, t) => sum + parseFloat(t.gasCostUsd || '0'), 0)

    // Calculate trade-level P&L (simplified: compare out value to in value)
    const tradePnls = trades.map((t) => {
      const inValue = parseFloat(t.amountInUsd || '0')
      const outValue = parseFloat(t.amountOutUsd || '0')
      return outValue - inValue
    })

    const winningTrades = tradePnls.filter((pnl) => pnl > 0).length
    const losingTrades = tradePnls.filter((pnl) => pnl < 0).length
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0

    const totalTradeValue = trades.reduce((sum, t) => sum + parseFloat(t.amountInUsd || '0'), 0)
    const avgTradeSizeUsd = totalTrades > 0 ? totalTradeValue / totalTrades : 0

    const bestTradeUsd = tradePnls.length > 0 ? Math.max(...tradePnls) : 0
    const worstTradeUsd = tradePnls.length > 0 ? Math.min(...tradePnls) : 0

    // Calculate timeframe
    const startTime = firstSnapshot?.timestamp || new Date()
    const endTime = new Date()
    const daysActive = Math.max(
      1,
      Math.floor((endTime.getTime() - startTime.getTime()) / (24 * 60 * 60 * 1000))
    )

    return {
      currentValueUsd,
      startingValueUsd,
      totalPnlUsd,
      totalPnlPercent,
      realizedPnlUsd,
      unrealizedPnlUsd,
      winningTrades,
      losingTrades,
      winRate,
      totalTrades,
      avgTradeSizeUsd,
      bestTradeUsd,
      worstTradeUsd,
      totalGasSpentUsd,
      timeframe: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        daysActive,
      },
    }
  }

  /**
   * Get a summary string for the agent
   */
  async getPerformanceSummary(
    getCurrentPrice: (token: string) => Promise<number>
  ): Promise<string> {
    const metrics = await this.getPerformanceMetrics(getCurrentPrice)

    const lines = [
      `📊 Portfolio Performance Summary`,
      ``,
      `💰 Value: $${metrics.currentValueUsd.toFixed(2)} (started: $${metrics.startingValueUsd.toFixed(2)})`,
      `📈 Total P&L: $${metrics.totalPnlUsd.toFixed(2)} (${metrics.totalPnlPercent >= 0 ? '+' : ''}${metrics.totalPnlPercent.toFixed(2)}%)`,
      `   - Realized: $${metrics.realizedPnlUsd.toFixed(2)}`,
      `   - Unrealized: $${metrics.unrealizedPnlUsd.toFixed(2)}`,
      ``,
      `📊 Trading Stats:`,
      `   - Total trades: ${metrics.totalTrades}`,
      `   - Win rate: ${metrics.winRate.toFixed(1)}% (${metrics.winningTrades}W / ${metrics.losingTrades}L)`,
      `   - Avg trade: $${metrics.avgTradeSizeUsd.toFixed(2)}`,
      `   - Best: $${metrics.bestTradeUsd.toFixed(2)} | Worst: $${metrics.worstTradeUsd.toFixed(2)}`,
      `   - Gas spent: $${metrics.totalGasSpentUsd.toFixed(2)}`,
      ``,
      `⏱️ Active for ${metrics.timeframe.daysActive} days`,
    ]

    return lines.join('\n')
  }
}

// Singleton instance
export const performanceTracker = new PerformanceTracker()
