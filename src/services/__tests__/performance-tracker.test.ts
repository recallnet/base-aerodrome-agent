/**
 * Performance Tracker Tests
 *
 * Tests for cost basis tracking, P&L calculations, and portfolio metrics.
 * Uses the actual database for integration testing.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../database/db.js'
import {
  portfolioSnapshots,
  positions,
  swapTransactions,
} from '../../database/schema/trading/defs.js'
import { performanceTracker } from '../performance-tracker.js'

describe('PerformanceTracker', () => {
  beforeEach(async () => {
    // Clear test data before each test
    await db.delete(positions)
    await db.delete(portfolioSnapshots)
    await db.delete(swapTransactions)
  })

  describe('recordBuy', () => {
    it('should create a new position on first buy', async () => {
      const position = await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100, // 100 AERO
        65 // $65 cost
      )

      expect(position.token).toBe('AERO')
      expect(parseFloat(position.balance)).toBe(100)
      expect(parseFloat(position.totalCostUsd)).toBe(65)
      expect(parseFloat(position.averageCostPerToken!)).toBeCloseTo(0.65, 2)
      expect(position.buyCount).toBe(1)
      expect(position.sellCount).toBe(0)
    })

    it('should update average cost on subsequent buys', async () => {
      // First buy: 100 AERO at $0.65 = $65
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      // Second buy: 50 AERO at $0.80 = $40
      const position = await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        50,
        40
      )

      // Total: 150 AERO, $105 cost
      expect(parseFloat(position.balance)).toBe(150)
      expect(parseFloat(position.totalCostUsd)).toBe(105)
      // Average cost: $105 / 150 = $0.70
      expect(parseFloat(position.averageCostPerToken!)).toBeCloseTo(0.7, 2)
      expect(position.buyCount).toBe(2)
      expect(parseFloat(position.totalBought)).toBe(150)
      expect(parseFloat(position.totalBuyCostUsd)).toBe(105)
    })

    it('should track multiple positions independently', async () => {
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      await performanceTracker.recordBuy(
        'BRETT',
        '0x532f27101965dd16442E59d40670FaF5eBB142E4',
        1000,
        50
      )

      const aeroPosition = await performanceTracker.getPosition('AERO')
      const brettPosition = await performanceTracker.getPosition('BRETT')

      expect(aeroPosition?.token).toBe('AERO')
      expect(parseFloat(aeroPosition!.balance)).toBe(100)

      expect(brettPosition?.token).toBe('BRETT')
      expect(parseFloat(brettPosition!.balance)).toBe(1000)
    })
  })

  describe('recordSell', () => {
    it('should calculate realized P&L correctly on profitable trade', async () => {
      // Buy 100 AERO at $0.65 = $65 cost
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      // Sell 50 AERO at $0.80 = $40 proceeds
      // Cost basis for 50 AERO = 50 * $0.65 = $32.50
      // Realized P&L = $40 - $32.50 = $7.50
      const result = await performanceTracker.recordSell('AERO', 50, 40)

      expect(result).not.toBeNull()
      const { position, realizedPnl } = result!

      expect(realizedPnl).toBeCloseTo(7.5, 2)
      expect(parseFloat(position.balance)).toBe(50)
      expect(position.sellCount).toBe(1)
      expect(parseFloat(position.realizedPnlUsd)).toBeCloseTo(7.5, 2)
      expect(parseFloat(position.totalSellProceedsUsd)).toBe(40)
    })

    it('should calculate realized P&L correctly on losing trade', async () => {
      // Buy 100 AERO at $0.80 = $80 cost
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        80
      )

      // Sell 100 AERO at $0.65 = $65 proceeds
      // Cost basis = $80
      // Realized P&L = $65 - $80 = -$15
      const result = await performanceTracker.recordSell('AERO', 100, 65)

      expect(result).not.toBeNull()
      const { position, realizedPnl } = result!

      expect(realizedPnl).toBeCloseTo(-15, 2)
      expect(parseFloat(position.balance)).toBe(0)
      expect(parseFloat(position.realizedPnlUsd)).toBeCloseTo(-15, 2)
    })

    it('should throw error when selling more than balance', async () => {
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      await expect(performanceTracker.recordSell('AERO', 150, 100)).rejects.toThrow(
        'Insufficient balance'
      )
    })

    it('should return null when selling token not owned (no cost basis)', async () => {
      const result = await performanceTracker.recordSell('NONEXISTENT', 50, 40)
      expect(result).toBeNull()
    })

    it('should accumulate realized P&L across multiple sells', async () => {
      // Buy 100 AERO at $0.65 = $65
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      // Sell 1: 30 AERO at $0.80 = $24
      // Cost: 30 * $0.65 = $19.50
      // P&L: $24 - $19.50 = $4.50
      await performanceTracker.recordSell('AERO', 30, 24)

      // Sell 2: 30 AERO at $0.70 = $21
      // Cost: 30 * $0.65 = $19.50
      // P&L: $21 - $19.50 = $1.50
      const result = await performanceTracker.recordSell('AERO', 30, 21)

      expect(result).not.toBeNull()
      const { position } = result!

      // Total realized P&L: $4.50 + $1.50 = $6.00
      expect(parseFloat(position.realizedPnlUsd)).toBeCloseTo(6, 2)
      expect(position.sellCount).toBe(2)
      expect(parseFloat(position.balance)).toBe(40)
    })
  })

  describe('createSnapshot', () => {
    it('should create portfolio snapshot with correct values', async () => {
      const balances = { ETH: '1.5', AERO: '100', USDC: '50' }
      const totalValueUsd = 5500 // $5500

      const snapshot = await performanceTracker.createSnapshot(balances, totalValueUsd, 1)

      expect(snapshot.iterationNumber).toBe(1)
      expect(parseFloat(snapshot.totalValueUsd!)).toBe(5500)
      expect(snapshot.balances).toEqual(balances)
    })

    it('should calculate P&L relative to first snapshot', async () => {
      // First snapshot: $1000
      await performanceTracker.createSnapshot({ USDC: '1000' }, 1000, 1)

      // Second snapshot: $1200 (20% gain)
      const snapshot2 = await performanceTracker.createSnapshot({ USDC: '1200' }, 1200, 2)

      expect(parseFloat(snapshot2.pnlUsd!)).toBe(200)
      expect(parseFloat(snapshot2.pnlPercent!)).toBeCloseTo(20, 2)
    })
  })

  describe('getAllPositions', () => {
    it('should return only positions with non-zero balance', async () => {
      // Create position with balance
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      // Create position and sell all
      await performanceTracker.recordBuy(
        'BRETT',
        '0x532f27101965dd16442E59d40670FaF5eBB142E4',
        50,
        25
      )
      await performanceTracker.recordSell('BRETT', 50, 30)

      const allPositions = await performanceTracker.getAllPositions()

      expect(allPositions.length).toBe(1)
      expect(allPositions[0].token).toBe('AERO')
    })
  })

  describe('getPositionsWithValues', () => {
    it('should calculate unrealized P&L correctly', async () => {
      // Buy 100 AERO at $0.65 = $65 cost
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      // Mock price function returning $0.80
      const mockGetPrice = async () => 0.8

      const positionsWithValues = await performanceTracker.getPositionsWithValues(mockGetPrice)

      expect(positionsWithValues.length).toBe(1)
      const aero = positionsWithValues[0]

      expect(aero.currentPriceUsd).toBe(0.8)
      expect(aero.currentValueUsd).toBe(80) // 100 * $0.80
      expect(aero.unrealizedPnlUsd).toBe(15) // $80 - $65
      expect(aero.unrealizedPnlPercent).toBeCloseTo(23.08, 1) // 15/65 * 100
    })
  })

  describe('getPerformanceMetrics', () => {
    it('should calculate comprehensive metrics', async () => {
      // Setup: Buy some tokens
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      // Create initial snapshot
      await performanceTracker.createSnapshot({ AERO: '100' }, 65, 1)

      // Mock price function
      const mockGetPrice = async () => 0.8

      const metrics = await performanceTracker.getPerformanceMetrics(mockGetPrice)

      expect(metrics.currentValueUsd).toBe(80) // 100 AERO * $0.80
      expect(metrics.startingValueUsd).toBe(65)
      expect(metrics.unrealizedPnlUsd).toBe(15) // $80 - $65
      expect(metrics.totalPnlPercent).toBeCloseTo(23.08, 1)
    })
  })

  describe('getPerformanceSummary', () => {
    it('should return formatted summary string', async () => {
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      await performanceTracker.createSnapshot({ AERO: '100' }, 65, 1)

      const mockGetPrice = async () => 0.8

      const summary = await performanceTracker.getPerformanceSummary(mockGetPrice)

      expect(summary).toContain('Portfolio Performance Summary')
      expect(summary).toContain('Value:')
      expect(summary).toContain('Total P&L:')
      expect(summary).toContain('Trading Stats:')
    })
  })

  describe('Edge Cases', () => {
    it('should handle very small amounts', async () => {
      const position = await performanceTracker.recordBuy(
        'BRETT',
        '0x532f27101965dd16442E59d40670FaF5eBB142E4',
        0.000001,
        0.00005
      )

      expect(parseFloat(position.balance)).toBeCloseTo(0.000001, 8)
      expect(parseFloat(position.averageCostPerToken!)).toBeCloseTo(50, 0) // $50 per token
    })

    it('should handle very large amounts', async () => {
      const position = await performanceTracker.recordBuy(
        'BRETT',
        '0x532f27101965dd16442E59d40670FaF5eBB142E4',
        1000000000, // 1 billion
        50000000 // $50 million
      )

      expect(parseFloat(position.balance)).toBe(1000000000)
      expect(parseFloat(position.totalCostUsd)).toBe(50000000)
    })

    it('should handle selling entire position', async () => {
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      const result = await performanceTracker.recordSell('AERO', 100, 80)

      expect(result).not.toBeNull()
      const { position } = result!

      expect(parseFloat(position.balance)).toBe(0)
      expect(parseFloat(position.totalCostUsd)).toBe(0)
      expect(parseFloat(position.realizedPnlUsd)).toBe(15) // $80 - $65
    })

    it('should handle case-insensitive token lookups', async () => {
      await performanceTracker.recordBuy(
        'AERO',
        '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        100,
        65
      )

      // Query with different case - should find it (implementation uppercases input)
      const positionLower = await performanceTracker.getPosition('aero')
      expect(positionLower).toBeDefined()
      expect(positionLower?.token).toBe('AERO')

      // Query with mixed case - should also find it
      const positionMixed = await performanceTracker.getPosition('Aero')
      expect(positionMixed).toBeDefined()
      expect(positionMixed?.token).toBe('AERO')
    })
  })
})
