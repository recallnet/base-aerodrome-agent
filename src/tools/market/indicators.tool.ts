/**
 * Technical Indicators Tool
 * Returns raw technical analysis data from multiple timeframes
 *
 * Data is fetched from CoinGecko's OHLCV API and indicators are calculated locally.
 * No interpretation - agent decides what the data means.
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { resolveToken } from '../../config/tokens.js'
import { type CandleData, fetchMultiTimeframeCandles } from './coingecko-client.js'
import { type TechnicalIndicators, calculateIndicators, getIndicatorSeries } from './indicators.js'
import { type MarketMetrics, calculateMarketMetrics } from './market-metrics.js'

/**
 * Timeframe data structure for output
 */
interface TimeframeData {
  /** Calculated technical indicators */
  indicators: TechnicalIndicators
  /** Derived market metrics */
  marketMetrics: MarketMetrics
  /** Recent price history (last 10 candles) */
  recentPrices: Array<{ timestamp: number; price: number }>
  /** Indicator series for trend analysis */
  series: {
    ema20: number[]
    rsi14: number[]
    macd: number[]
  }
  /** Number of candles used for calculations */
  candleCount: number
}

/**
 * Output schema type
 */
interface IndicatorsOutput {
  success: boolean
  token: {
    symbol: string
    address: string
  }
  /** 5-minute timeframe data (intraday) */
  intraday: TimeframeData | null
  /** 4-hour timeframe data (longer-term) */
  longTerm: TimeframeData | null
  /** Current price from most recent candle */
  currentPrice: number | null
  /** Data source information */
  source: string
  /** Errors encountered during fetch */
  errors: string[]
}

/**
 * Process candles into timeframe data
 */
function processTimeframeData(candles: CandleData[]): TimeframeData | null {
  if (candles.length === 0) {
    return null
  }

  const indicators = calculateIndicators(candles)
  const marketMetrics = calculateMarketMetrics(candles, indicators)

  // Get indicator series (last 10 values for each)
  const ema20Series = getIndicatorSeries(candles, 'ema', 20, 10)
  const rsi14Series = getIndicatorSeries(candles, 'rsi', 14, 10)
  const macdSeries = getIndicatorSeries(candles, 'macd', 26, 10)

  // Recent price history (last 10 candles)
  const recentPrices = candles.slice(-10).map((c) => ({
    timestamp: c.timestamp,
    price: c.close,
  }))

  return {
    indicators,
    marketMetrics,
    recentPrices,
    series: {
      ema20: ema20Series,
      rsi14: rsi14Series,
      macd: macdSeries,
    },
    candleCount: candles.length,
  }
}

/**
 * Technical Indicators schema for Zod
 */
const technicalIndicatorsSchema = z.object({
  ema20: z.number().nullable(),
  ema50: z.number().nullable(),
  sma20: z.number().nullable(),
  rsi7: z.number().nullable(),
  rsi14: z.number().nullable(),
  macd: z.number().nullable(),
  macdSignal: z.number().nullable(),
  macdHistogram: z.number().nullable(),
  atr14: z.number().nullable(),
  vwap: z.number().nullable(),
})

/**
 * Market Metrics schema for Zod
 */
const marketMetricsSchema = z.object({
  emaSeparationRatio: z.number().nullable(),
  priceEma20Deviation: z.number().nullable(),
  priceEma50Deviation: z.number().nullable(),
  currentRangePercent: z.number().nullable(),
  avgRangePercent20: z.number().nullable(),
  volatilityRatio: z.number().nullable(),
  atrPriceRatio: z.number().nullable(),
  rsiValue: z.number().nullable(),
  rsiDistanceFrom50: z.number().nullable(),
  macdValue: z.number().nullable(),
  macdSignalValue: z.number().nullable(),
  macdCrossDistance: z.number().nullable(),
  macdHistogram: z.number().nullable(),
  macdHistogramSlope3: z.number().nullable(),
  higherHighsCount20: z.number(),
  lowerLowsCount20: z.number(),
  higherLowsCount20: z.number(),
  lowerHighsCount20: z.number(),
  consecutiveGreenCandles: z.number(),
  consecutiveRedCandles: z.number(),
  rangePosition20: z.number().nullable(),
  distanceFromHigh20: z.number().nullable(),
  distanceFromLow20: z.number().nullable(),
  volumeRatio20: z.number().nullable(),
  volumeTrend5: z.number().nullable(),
  priceVelocity5: z.number().nullable(),
  priceVelocity10: z.number().nullable(),
  currentBodyRatio: z.number().nullable(),
  upperWickRatio: z.number().nullable(),
  lowerWickRatio: z.number().nullable(),
})

/**
 * Timeframe data schema for Zod
 */
const timeframeDataSchema = z
  .object({
    indicators: technicalIndicatorsSchema,
    marketMetrics: marketMetricsSchema,
    recentPrices: z.array(z.object({ timestamp: z.number(), price: z.number() })),
    series: z.object({
      ema20: z.array(z.number()),
      rsi14: z.array(z.number()),
      macd: z.array(z.number()),
    }),
    candleCount: z.number(),
  })
  .nullable()

export const getIndicatorsTool = createTool({
  id: 'get-technical-indicators',
  description: `Get technical indicators and market metrics for a token.
Returns raw indicator data from two timeframes: 5-minute (intraday) and 4-hour (longer-term).

Includes:
- EMA20, EMA50, SMA20 (moving averages)
- RSI7, RSI14 (momentum)
- MACD, signal line, histogram (trend)
- ATR14 (volatility)
- VWAP (volume-weighted price)
- Market structure metrics (higher highs/lows counts, consecutive candles)
- Volatility metrics (range ratios, ATR/price ratio)
- Price velocity and candle analysis

Use this to analyze market conditions before making trading decisions.
Requires COINGECKO_API_KEY environment variable.`,

  inputSchema: z.object({
    token: z.string().describe("Token symbol (e.g., 'AERO', 'WETH') or contract address"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    token: z.object({
      symbol: z.string(),
      address: z.string(),
    }),
    intraday: timeframeDataSchema.describe('5-minute timeframe data'),
    longTerm: timeframeDataSchema.describe('4-hour timeframe data'),
    currentPrice: z.number().nullable(),
    source: z.string(),
    errors: z.array(z.string()),
  }),

  execute: async ({ context }): Promise<IndicatorsOutput> => {
    const { token } = context

    // Resolve token to get address
    const tokenMeta = resolveToken(token)

    if (!tokenMeta) {
      console.error(`  ❌ getIndicators FAILED: Unknown token: ${token}`)
      return {
        success: false,
        token: { symbol: token, address: '' },
        intraday: null,
        longTerm: null,
        currentPrice: null,
        source: 'coingecko',
        errors: [`Unknown token: ${token}`],
      }
    }

    // Fetch candles for both timeframes
    const { candles5m, candles4h, errors } = await fetchMultiTimeframeCandles(
      tokenMeta.address,
      'base'
    )

    // Process timeframe data
    const intradayData = processTimeframeData(candles5m)
    const longTermData = processTimeframeData(candles4h)

    // Get current price from most recent candle
    let currentPrice: number | null = null
    if (candles5m.length > 0) {
      currentPrice = candles5m[candles5m.length - 1].close
    } else if (candles4h.length > 0) {
      currentPrice = candles4h[candles4h.length - 1].close
    }

    const success = (intradayData !== null || longTermData !== null) && errors.length === 0

    if (!success) {
      console.error(`  ❌ getIndicators FAILED for ${tokenMeta.symbol}: ${errors.join(', ')}`)
    }

    return {
      success,
      token: {
        symbol: tokenMeta.symbol,
        address: tokenMeta.address,
      },
      intraday: intradayData,
      longTerm: longTermData,
      currentPrice,
      source: 'coingecko',
      errors,
    }
  },
})
