/**
 * CoinGecko OHLCV Client
 * Fetches candlestick data from CoinGecko's Onchain DEX API
 * Supports both Pro (paid) and Demo (free) API tiers
 *
 * API Endpoint: GET {baseUrl}/onchain/networks/{network}/tokens/{token_address}/ohlcv/{timeframe}
 *
 * @see https://docs.coingecko.com/reference/token-ohlcv-token-address
 */

import { getCoinGeckoConfig } from '../../config/index.js'

/**
 * Timeframe options for OHLCV data
 */
export type OHLCVTimeframe = 'day' | 'hour' | 'minute'

/**
 * Aggregate period options by timeframe
 * - day: 1
 * - hour: 1, 4, 12
 * - minute: 1, 5, 15
 */
export type AggregatePeriod = '1' | '4' | '5' | '12' | '15'

/**
 * Single candlestick data point
 */
export interface CandleData {
  /** Unix timestamp (seconds) at start of interval */
  timestamp: number
  /** Opening price */
  open: number
  /** Highest price during interval */
  high: number
  /** Lowest price during interval */
  low: number
  /** Closing price */
  close: number
  /** Trading volume during interval */
  volume: number
}

/**
 * Token metadata from CoinGecko response
 */
interface TokenMeta {
  address: string
  name: string
  symbol: string
  coingecko_coin_id: string
}

/**
 * CoinGecko OHLCV API response structure
 */
interface CoinGeckoOHLCVResponse {
  data: {
    id: string
    type: string
    attributes: {
      ohlcv_list: Array<[number, number, number, number, number, number]>
    }
  }
  meta: {
    base: TokenMeta
    quote: TokenMeta
  }
}

/**
 * Options for fetching OHLCV data
 */
export interface FetchOHLCVOptions {
  /** Token contract address */
  tokenAddress: string
  /** Network ID (default: 'base') */
  network?: string
  /** Timeframe: 'day', 'hour', or 'minute' */
  timeframe: OHLCVTimeframe
  /** Aggregate period (depends on timeframe) */
  aggregate?: AggregatePeriod
  /** Number of candles to fetch (max 1000, default 100) */
  limit?: number
  /** Fetch data before this Unix timestamp */
  beforeTimestamp?: number
  /** Currency for prices: 'usd' or 'token' */
  currency?: 'usd' | 'token'
}

/**
 * Result of OHLCV fetch
 */
export interface OHLCVResult {
  success: boolean
  candles: CandleData[]
  baseToken: TokenMeta | null
  quoteToken: TokenMeta | null
  error?: string
}

/**
 * Validate aggregate value for the given timeframe
 */
function validateAggregate(timeframe: OHLCVTimeframe, aggregate: string): boolean {
  const validValues: Record<OHLCVTimeframe, string[]> = {
    day: ['1'],
    hour: ['1', '4', '12'],
    minute: ['1', '5', '15'],
  }
  return validValues[timeframe].includes(aggregate)
}

/**
 * Fetch OHLCV candlestick data from CoinGecko
 *
 * @param options - Fetch options
 * @returns OHLCV result with candles array
 */
export async function fetchOHLCV(options: FetchOHLCVOptions): Promise<OHLCVResult> {
  const config = getCoinGeckoConfig()
  if (!config) {
    return {
      success: false,
      candles: [],
      baseToken: null,
      quoteToken: null,
      error: 'CoinGecko API key not set. Set COINGECKO_PRO_API_KEY or COINGECKO_DEMO_API_KEY',
    }
  }

  const {
    tokenAddress: rawTokenAddress,
    network = 'base',
    timeframe,
    aggregate = '1',
    limit = 100,
    beforeTimestamp,
    currency = 'usd',
  } = options

  // Normalize address to lowercase (CoinGecko expects lowercase)
  const tokenAddress = rawTokenAddress.toLowerCase()

  // Validate aggregate for timeframe
  if (!validateAggregate(timeframe, aggregate)) {
    return {
      success: false,
      candles: [],
      baseToken: null,
      quoteToken: null,
      error: `Invalid aggregate '${aggregate}' for timeframe '${timeframe}'`,
    }
  }

  // Build URL using configured base URL
  const baseUrl = `${config.baseUrl}/onchain/networks`
  const url = new URL(`${baseUrl}/${network}/tokens/${tokenAddress}/ohlcv/${timeframe}`)

  // Add query parameters
  url.searchParams.set('aggregate', aggregate)
  url.searchParams.set('limit', Math.min(limit, 1000).toString())
  url.searchParams.set('currency', currency)

  if (beforeTimestamp) {
    url.searchParams.set('before_timestamp', beforeTimestamp.toString())
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        [config.headerName]: config.apiKey,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        candles: [],
        baseToken: null,
        quoteToken: null,
        error: `CoinGecko API error: ${response.status} - ${errorText}`,
      }
    }

    const data = (await response.json()) as CoinGeckoOHLCVResponse

    // Parse OHLCV list into CandleData objects
    const candles: CandleData[] = data.data.attributes.ohlcv_list.map((item) => ({
      timestamp: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: item[5],
    }))

    // Sort by timestamp ascending (oldest first)
    candles.sort((a, b) => a.timestamp - b.timestamp)

    return {
      success: true,
      candles,
      baseToken: data.meta.base,
      quoteToken: data.meta.quote,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      candles: [],
      baseToken: null,
      quoteToken: null,
      error: `Failed to fetch OHLCV data: ${errorMessage}`,
    }
  }
}

/**
 * Fetch candles for multiple timeframes
 *
 * @param tokenAddress - Token contract address
 * @param network - Network ID (default: 'base')
 * @returns Object with 5m and 4h candle arrays
 */
export async function fetchMultiTimeframeCandles(
  tokenAddress: string,
  network: string = 'base'
): Promise<{
  candles5m: CandleData[]
  candles4h: CandleData[]
  errors: string[]
}> {
  const errors: string[] = []

  // Fetch 5-minute candles
  const result5m = await fetchOHLCV({
    tokenAddress,
    network,
    timeframe: 'minute',
    aggregate: '5',
    limit: 100,
  })

  if (!result5m.success) {
    errors.push(`5m: ${result5m.error}`)
  }

  // Fetch 4-hour candles
  const result4h = await fetchOHLCV({
    tokenAddress,
    network,
    timeframe: 'hour',
    aggregate: '4',
    limit: 100,
  })

  if (!result4h.success) {
    errors.push(`4h: ${result4h.error}`)
  }

  return {
    candles5m: result5m.candles,
    candles4h: result4h.candles,
    errors,
  }
}
