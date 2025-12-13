/**
 * Aerodrome Pool Metrics Tool - Integration Test
 * Tests real pool data fetching from Aerodrome on Base chain
 * Covers both V2 (classic AMM) and Slipstream (CL) pools
 */
import { describe, expect, it } from 'vitest'

import { TOKEN_ADDRESSES } from '../../../config/tokens'
import { getPoolMetricsTool } from '../pool.tool'

const getPoolMetrics = (tokenA: string, tokenB: string) =>
  getPoolMetricsTool.execute({
    context: { tokenA, tokenB },
    runtimeContext: {} as never,
  })

describe('Aerodrome Pool Metrics Tool - Slipstream (CL) Pools', () => {
  it('gets Slipstream pool metrics for WETH/USDC', async () => {
    const result = await getPoolMetrics('WETH', 'USDC')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Should use Slipstream pool (dynamically discovered)
    expect(result.poolType).toBe('slipstream')
    expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

    // Should have tick spacing (value depends on which pool exists)
    expect(result.tickSpacing).toBeDefined()
    expect(result.tickSpacing).toBeGreaterThan(0)

    // Tokens should be correctly identified
    const symbols = [result.token0.symbol, result.token1.symbol]
    expect(symbols).toContain('WETH')
    expect(symbols).toContain('USDC')

    // Slipstream pools return liquidity instead of reserves
    expect(result.liquidity).toBeDefined()
    expect(BigInt(result.liquidity!)).toBeGreaterThan(0n)

    // Should have sqrtPriceX96
    expect(result.sqrtPriceX96).toBeDefined()
    expect(BigInt(result.sqrtPriceX96!)).toBeGreaterThan(0n)

    // Should have current tick
    expect(result.tick).toBeDefined()
    expect(typeof result.tick).toBe('number')

    // Reserves should be '0' for Slipstream pools
    expect(result.token0.reserve).toBe('0')
    expect(result.token1.reserve).toBe('0')

    console.log('WETH/USDC Slipstream Pool:', result.poolAddress)
    console.log('  Pool type:', result.poolType)
    console.log('  Tick spacing:', result.tickSpacing)
    console.log('  Liquidity:', result.liquidity)
    console.log('  sqrtPriceX96:', result.sqrtPriceX96)
    console.log('  Current tick:', result.tick)
  }, 30000)

  it('gets Slipstream pool metrics for AERO/WETH', async () => {
    const result = await getPoolMetrics('AERO', 'WETH')

    expect(result.success).toBe(true)
    expect(result.poolType).toBe('slipstream')
    // Tick spacing is dynamically discovered
    expect(result.tickSpacing).toBeDefined()
    expect(result.tickSpacing).toBeGreaterThan(0)

    expect(result.liquidity).toBeDefined()
    expect(BigInt(result.liquidity!)).toBeGreaterThan(0n)

    console.log('AERO/WETH Slipstream Pool:', result.poolAddress)
    console.log('  Tick spacing:', result.tickSpacing)
    console.log('  Liquidity:', result.liquidity)
  }, 30000)

  it('gets Slipstream pool metrics for AERO/USDC', async () => {
    const result = await getPoolMetrics('AERO', 'USDC')

    expect(result.success).toBe(true)
    expect(result.poolType).toBe('slipstream')
    // Tick spacing is dynamically discovered
    expect(result.tickSpacing).toBeDefined()
    expect(result.tickSpacing).toBeGreaterThan(0)

    expect(result.liquidity).toBeDefined()
    expect(result.sqrtPriceX96).toBeDefined()
    expect(result.tick).toBeDefined()

    console.log('AERO/USDC Slipstream Pool:', result.poolAddress)
    console.log('  Tick spacing:', result.tickSpacing)
    console.log('  Liquidity:', result.liquidity)
  }, 30000)
})

describe('Aerodrome Pool Metrics Tool - Dynamic Discovery', () => {
  it('gets pool metrics for BRETT/WETH (dynamically discovered)', async () => {
    const result = await getPoolMetrics('BRETT', 'WETH')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Pool type is dynamically discovered (could be v2 or slipstream)
    expect(['v2', 'slipstream']).toContain(result.poolType)
    expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

    // Either has reserves (V2) or liquidity (Slipstream)
    if (result.poolType === 'v2') {
      const reserve0 = parseFloat(result.token0.reserve)
      const reserve1 = parseFloat(result.token1.reserve)
      expect(reserve0).toBeGreaterThan(0)
      expect(reserve1).toBeGreaterThan(0)
    } else {
      expect(result.liquidity).toBeDefined()
      expect(BigInt(result.liquidity!)).toBeGreaterThan(0n)
    }

    console.log('BRETT/WETH Pool:', result.poolAddress)
    console.log('  Pool type:', result.poolType)
    if (result.poolType === 'slipstream') {
      console.log('  Tick spacing:', result.tickSpacing)
      console.log('  Liquidity:', result.liquidity)
    } else {
      console.log(`  ${result.token0.symbol}: ${result.token0.reserve}`)
      console.log(`  ${result.token1.symbol}: ${result.token1.reserve}`)
    }
  }, 30000)

  it('returns correct token decimals for BRETT/WETH', async () => {
    const result = await getPoolMetrics('BRETT', 'WETH')

    expect(result.success).toBe(true)

    // Find WETH in results
    const wethToken = result.token0.symbol === 'WETH' ? result.token0 : result.token1
    const brettToken = result.token0.symbol === 'BRETT' ? result.token0 : result.token1

    // WETH has 18 decimals
    expect(wethToken.decimals).toBe(18)

    // BRETT has 18 decimals
    expect(brettToken.decimals).toBe(18)

    console.log('Decimals:', {
      WETH: wethToken.decimals,
      BRETT: brettToken.decimals,
    })
  }, 30000)

  it('handles unknown token gracefully', async () => {
    const result = await getPoolMetrics('UNKNOWNTOKEN', 'USDC')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown token')
  })

  it('accepts token addresses instead of symbols', async () => {
    const result = await getPoolMetrics(TOKEN_ADDRESSES.WETH, TOKEN_ADDRESSES.BRETT)

    expect(result.success).toBe(true)
    expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

    const symbols = [result.token0.symbol, result.token1.symbol]
    expect(symbols).toContain('WETH')
    expect(symbols).toContain('BRETT')

    console.log('Pool by address:', result.poolAddress)
  }, 30000)
})

describe('Aerodrome Pool Metrics Tool - Stable Pools', () => {
  it('gets stable pool metrics for USDC/USDbC', async () => {
    const result = await getPoolMetrics('USDC', 'USDbC')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

    // Stable pools should have isStable=true if V2, or be Slipstream
    if (result.poolType === 'v2') {
      expect(result.isStable).toBe(true)
      // V2 pools have reserves
      const reserve0 = parseFloat(result.token0.reserve)
      const reserve1 = parseFloat(result.token1.reserve)
      expect(reserve0).toBeGreaterThan(0)
      expect(reserve1).toBeGreaterThan(0)
    } else {
      // Slipstream pools have liquidity
      expect(result.liquidity).toBeDefined()
    }

    console.log('USDC/USDbC Pool:', result.poolAddress)
    console.log('  Pool type:', result.poolType)
    console.log('  Is stable:', result.isStable)
  }, 30000)
})

describe('Aerodrome Pool Metrics Tool - V2 Fallback', () => {
  it('handles pool metrics for DEGEN/TOSHI (less common pair)', async () => {
    const result = await getPoolMetrics('DEGEN', 'TOSHI')

    // Either finds a pool or returns error (both are valid outcomes)
    if (result.success) {
      expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(['v2', 'slipstream']).toContain(result.poolType)

      if (result.poolType === 'v2') {
        // V2 pools have reserves
        expect(result.token0.reserveRaw).toMatch(/^\d+$/)
        expect(result.token1.reserveRaw).toMatch(/^\d+$/)
        console.log('DEGEN/TOSHI V2 Pool found:', result.poolAddress)
        console.log(`  ${result.token0.symbol}: ${result.token0.reserve}`)
        console.log(`  ${result.token1.symbol}: ${result.token1.reserve}`)
      } else {
        console.log('DEGEN/TOSHI Slipstream Pool found:', result.poolAddress)
        console.log('  Tick spacing:', result.tickSpacing)
      }
    } else {
      // No pool exists - this is also a valid test case
      expect(result.error).toBeDefined()
      console.log('DEGEN/TOSHI: No pool found (expected for uncommon pairs)')
    }
  }, 30000)

  it('handles no pool found gracefully', async () => {
    // Test with a pair that likely has no pool
    const result = await getPoolMetrics('MIGGLES', 'PONKE')

    // Either finds a pool or returns appropriate error
    if (!result.success) {
      expect(result.error).toContain('No pool found')
      console.log('MIGGLES/PONKE: Correctly returned no pool found')
    } else {
      // If a pool exists, it should have valid data
      expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      console.log('MIGGLES/PONKE: Unexpectedly found pool at', result.poolAddress)
    }
  }, 30000)
})

describe('Aerodrome Pool Metrics Tool - General', () => {
  it('returns correct token addresses for Slipstream pool', async () => {
    const result = await getPoolMetrics('WETH', 'USDC')

    expect(result.success).toBe(true)
    expect(result.poolType).toBe('slipstream')

    // Addresses should match our config
    const addresses = [result.token0.address.toLowerCase(), result.token1.address.toLowerCase()]
    expect(addresses).toContain(TOKEN_ADDRESSES.WETH.toLowerCase())
    expect(addresses).toContain(TOKEN_ADDRESSES.USDC.toLowerCase())
  }, 30000)

  it('returns correct token decimals for Slipstream pool', async () => {
    const result = await getPoolMetrics('WETH', 'USDC')

    expect(result.success).toBe(true)
    expect(result.poolType).toBe('slipstream')

    // Find WETH and USDC in results
    const wethToken = result.token0.symbol === 'WETH' ? result.token0 : result.token1
    const usdcToken = result.token0.symbol === 'USDC' ? result.token0 : result.token1

    // WETH has 18 decimals
    expect(wethToken.decimals).toBe(18)

    // USDC has 6 decimals
    expect(usdcToken.decimals).toBe(6)

    console.log('Decimals:', {
      WETH: wethToken.decimals,
      USDC: usdcToken.decimals,
    })
  }, 30000)
})
