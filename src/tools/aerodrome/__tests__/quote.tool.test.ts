/**
 * Aerodrome Quote Tool - Integration Test
 * Calls actual Aerodrome Router contract on Base chain
 */
import { describe, expect, it } from 'vitest'

import { TOKEN_ADDRESSES } from '@/config/tokens'

import { getQuoteTool } from '../quote.tool'

/** Helper for quotes (single-hop or with optional via) */
const getQuote = (tokenIn: string, tokenOut: string, amountIn: string, via?: string) =>
  getQuoteTool.execute({
    context: { tokenIn, tokenOut, amountIn, ...(via && { via }) },
    runtimeContext: {} as never,
  })

/** Helper for multi-hop quotes */
const getMultiHopQuote = (tokenIn: string, tokenOut: string, amountIn: string, via: string) =>
  getQuoteTool.execute({
    context: { tokenIn, tokenOut, amountIn, via },
    runtimeContext: {} as never,
  })

describe('Aerodrome Quote Tool', () => {
  it('gets quote for USDC -> AERO', async () => {
    const result = await getQuote('USDC', 'AERO', '100')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Token metadata
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenIn.address).toBe(TOKEN_ADDRESSES.USDC)
    expect(result.tokenIn.decimals).toBe(6)
    expect(result.tokenIn.amountIn).toBe('100')

    expect(result.tokenOut.symbol).toBe('AERO')
    expect(result.tokenOut.address).toBe(TOKEN_ADDRESSES.AERO)
    expect(result.tokenOut.decimals).toBe(18)

    // Should get some AERO output
    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    // Route path should be direct
    expect(result.route.path).toEqual(['USDC', 'AERO'])
    expect(result.route.hops).toBe(1)

    // Pool type depends on what's discovered on-chain
    console.log('100 USDC =', result.tokenOut.amountOut, 'AERO')
    console.log('  Pool type:', result.poolType)
    console.log('  Tick spacing:', result.tickSpacing)
  }, 15000)

  it('gets quote for WETH -> USDC', async () => {
    const result = await getQuote('WETH', 'USDC', '0.1')

    expect(result.success).toBe(true)

    expect(result.tokenIn.symbol).toBe('WETH')
    expect(result.tokenIn.decimals).toBe(18)

    expect(result.tokenOut.symbol).toBe('USDC')
    expect(result.tokenOut.decimals).toBe(6)

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    // Should be roughly $300 for 0.1 ETH at current prices
    expect(amountOut).toBeGreaterThan(100)
    expect(amountOut).toBeLessThan(1000)

    console.log('0.1 WETH =', result.tokenOut.amountOut, 'USDC')
    console.log('  Pool type:', result.poolType)
  }, 15000)

  it('returns raw amounts for precise calculations', async () => {
    const result = await getQuote('USDC', 'AERO', '100')

    expect(result.success).toBe(true)

    // amountInRaw should be 100 * 10^6 (USDC has 6 decimals)
    expect(result.tokenIn.amountInRaw).toBe('100000000')

    // amountOutRaw should be a large number (AERO has 18 decimals)
    const amountOutRaw = BigInt(result.tokenOut.amountOutRaw)
    expect(amountOutRaw).toBeGreaterThan(0n)

    console.log('Raw amounts:', {
      in: result.tokenIn.amountInRaw,
      out: result.tokenOut.amountOutRaw,
    })
  }, 15000)

  it('handles unknown token gracefully', async () => {
    const result = await getQuote('UNKNOWNTOKEN', 'USDC', '100')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown token')
  })

  it('accepts token addresses instead of symbols', async () => {
    const result = await getQuote(TOKEN_ADDRESSES.USDC, TOKEN_ADDRESSES.AERO, '100')

    expect(result.success).toBe(true)
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenOut.symbol).toBe('AERO')

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log('100 USDC (by address) =', result.tokenOut.amountOut, 'AERO')
  }, 15000)
})

describe('Aerodrome Quote Tool - Multi-Hop Routing', () => {
  it('gets multi-hop quote USDC -> WETH -> BRETT', async () => {
    // BRETT doesn't have a direct USDC pool, so we route through WETH
    const result = await getMultiHopQuote('USDC', 'BRETT', '10', 'WETH')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Token metadata
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenOut.symbol).toBe('BRETT')

    // Should get some BRETT output
    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    // Route should show 3-token path with 2 hops
    expect(result.route.path).toEqual(['USDC', 'WETH', 'BRETT'])
    expect(result.route.hops).toBe(2)

    // Stable flags should be an array for multi-hop
    expect(Array.isArray(result.route.stable)).toBe(true)
    expect((result.route.stable as boolean[]).length).toBe(2)

    console.log('Multi-hop: 10 USDC → WETH → BRETT =', result.tokenOut.amountOut, 'BRETT')
  }, 15000)

  it('gets multi-hop quote AERO -> WETH -> cbBTC', async () => {
    // Route AERO through WETH to get cbBTC
    const result = await getMultiHopQuote('AERO', 'cbBTC', '100', 'WETH')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    expect(result.tokenIn.symbol).toBe('AERO')
    expect(result.tokenOut.symbol).toBe('cbBTC')

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    expect(result.route.path).toEqual(['AERO', 'WETH', 'cbBTC'])
    expect(result.route.hops).toBe(2)

    console.log('Multi-hop: 100 AERO → WETH → cbBTC =', result.tokenOut.amountOut, 'cbBTC')
  }, 15000)

  it('single-hop still works without via parameter', async () => {
    // Verify backward compatibility
    const result = await getQuote('USDC', 'WETH', '100')

    expect(result.success).toBe(true)
    expect(result.route.path).toEqual(['USDC', 'WETH'])
    expect(result.route.hops).toBe(1)

    // Stable flag should be a boolean for single-hop
    expect(typeof result.route.stable).toBe('boolean')

    console.log('Single-hop: 100 USDC =', result.tokenOut.amountOut, 'WETH')
  }, 15000)

  it('handles unknown intermediate token gracefully', async () => {
    const result = await getMultiHopQuote('USDC', 'BRETT', '10', 'UNKNOWNVIA')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown intermediate token')
  })

  it('compares single-hop vs multi-hop efficiency', async () => {
    // Get direct quote USDC -> AERO
    const directQuote = await getQuote('USDC', 'AERO', '100')

    // Get multi-hop quote USDC -> WETH -> AERO (should be less efficient due to extra hop)
    const multiHopQuote = await getMultiHopQuote('USDC', 'AERO', '100', 'WETH')

    expect(directQuote.success).toBe(true)
    expect(multiHopQuote.success).toBe(true)

    const directAmount = parseFloat(directQuote.tokenOut.amountOut)
    const multiHopAmount = parseFloat(multiHopQuote.tokenOut.amountOut)

    // Direct route should typically be more efficient (more output)
    // but multi-hop should still give reasonable output
    expect(directAmount).toBeGreaterThan(0)
    expect(multiHopAmount).toBeGreaterThan(0)

    console.log('Efficiency comparison for 100 USDC -> AERO:')
    console.log('  Direct (1 hop):', directAmount.toFixed(4), 'AERO')
    console.log('  Via WETH (2 hops):', multiHopAmount.toFixed(4), 'AERO')
    console.log(
      '  Difference:',
      (((directAmount - multiHopAmount) / directAmount) * 100).toFixed(2) + '%'
    )
  }, 30000)
})

describe('Aerodrome Quote Tool - Slipstream (CL) Pools', () => {
  it('uses Slipstream for WETH/USDC pair', async () => {
    const result = await getQuote('WETH', 'USDC', '0.1')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Should use Slipstream pool type (dynamically discovered)
    expect(result.poolType).toBe('slipstream')

    // Should return tickSpacing for Slipstream pools (value depends on which pool exists)
    expect(result.tickSpacing).toBeDefined()
    expect(result.tickSpacing).toBeGreaterThan(0)

    // Should get reasonable output
    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(100) // ~$300+ for 0.1 ETH
    expect(amountOut).toBeLessThan(1000)

    console.log('Slipstream: 0.1 WETH =', result.tokenOut.amountOut, 'USDC')
    console.log('  Pool type:', result.poolType)
    console.log('  Tick spacing:', result.tickSpacing)
  }, 15000)

  it('uses Slipstream for USDC/WETH (reverse direction)', async () => {
    const result = await getQuote('USDC', 'WETH', '100')

    expect(result.success).toBe(true)
    expect(result.poolType).toBe('slipstream')
    // Tick spacing is dynamically discovered
    expect(result.tickSpacing).toBeDefined()
    expect(result.tickSpacing).toBeGreaterThan(0)

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)
    expect(amountOut).toBeLessThan(1) // ~0.03 WETH for $100

    console.log('Slipstream: 100 USDC =', result.tokenOut.amountOut, 'WETH')
    console.log('  Tick spacing:', result.tickSpacing)
  }, 15000)

  it('uses Slipstream for AERO/WETH pair', async () => {
    const result = await getQuote('AERO', 'WETH', '100')

    expect(result.success).toBe(true)
    expect(result.poolType).toBe('slipstream')
    // Tick spacing is dynamically discovered
    expect(result.tickSpacing).toBeDefined()
    expect(result.tickSpacing).toBeGreaterThan(0)

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log('Slipstream: 100 AERO =', result.tokenOut.amountOut, 'WETH')
    console.log('  Tick spacing:', result.tickSpacing)
  }, 15000)

  it('uses Slipstream for AERO/USDC pair', async () => {
    const result = await getQuote('AERO', 'USDC', '100')

    expect(result.success).toBe(true)
    expect(result.poolType).toBe('slipstream')
    // Tick spacing is dynamically discovered
    expect(result.tickSpacing).toBeDefined()
    expect(result.tickSpacing).toBeGreaterThan(0)

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log('Slipstream: 100 AERO =', result.tokenOut.amountOut, 'USDC')
    console.log('  Tick spacing:', result.tickSpacing)
  }, 15000)

  it('discovers best pool for BRETT/WETH (dynamically)', async () => {
    const result = await getQuote('WETH', 'BRETT', '0.01')

    expect(result.success).toBe(true)
    // Pool type is dynamically discovered
    expect(['v2', 'slipstream']).toContain(result.poolType)

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log('BRETT/WETH: 0.01 WETH =', result.tokenOut.amountOut, 'BRETT')
    console.log('  Pool type:', result.poolType)
    if (result.poolType === 'slipstream') {
      console.log('  Tick spacing:', result.tickSpacing)
    }
  }, 15000)

  it('returns valid quotes for both Slipstream and dynamically discovered pools', async () => {
    // Get Slipstream quote (WETH/USDC - known Slipstream pool)
    const slipstreamResult = await getQuote('WETH', 'USDC', '1')
    expect(slipstreamResult.success).toBe(true)
    expect(slipstreamResult.poolType).toBe('slipstream')

    // Get quote for dynamically discovered pool (WETH/BRETT)
    const dynamicResult = await getQuote('WETH', 'BRETT', '1')
    expect(dynamicResult.success).toBe(true)
    // Pool type depends on what's available on-chain
    expect(['v2', 'slipstream']).toContain(dynamicResult.poolType)

    // Both should have output
    expect(parseFloat(slipstreamResult.tokenOut.amountOut)).toBeGreaterThan(0)
    expect(parseFloat(dynamicResult.tokenOut.amountOut)).toBeGreaterThan(0)

    console.log('Quote comparison:')
    console.log(
      `  WETH/USDC (${slipstreamResult.poolType}): 1 WETH =`,
      slipstreamResult.tokenOut.amountOut,
      'USDC'
    )
    console.log(
      `  WETH/BRETT (${dynamicResult.poolType}): 1 WETH =`,
      dynamicResult.tokenOut.amountOut,
      'BRETT'
    )
  }, 15000)
})

describe('Aerodrome Quote Tool - Stable Pools', () => {
  it('gets quote for USDC -> USDbC (stable pair)', async () => {
    const result = await getQuote('USDC', 'USDbC', '100')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenOut.symbol).toBe('USDbC')

    // Stable swap should give close to 1:1
    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(90) // At least 90 USDbC for 100 USDC
    expect(amountOut).toBeLessThan(110) // No more than 110

    // Route should use stable pool if V2
    if (result.poolType === 'v2') {
      expect(result.route.stable).toBe(true)
    }

    console.log('100 USDC =', result.tokenOut.amountOut, 'USDbC')
    console.log('  Pool type:', result.poolType)
    console.log('  Route stable:', result.route.stable)
  }, 15000)

  it('gets quote for USDbC -> USDC (reverse stable)', async () => {
    const result = await getQuote('USDbC', 'USDC', '100')

    expect(result.success).toBe(true)

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(90)
    expect(amountOut).toBeLessThan(110)

    console.log('100 USDbC =', result.tokenOut.amountOut, 'USDC')
  }, 15000)
})

describe('Aerodrome Quote Tool - Edge Cases', () => {
  it('handles quote for pair with no direct pool via multi-hop', async () => {
    // DEGEN to cbBTC likely requires multi-hop
    const result = await getMultiHopQuote('DEGEN', 'cbBTC', '1000', 'WETH')

    expect(result.success).toBe(true)
    expect(result.route.path).toEqual(['DEGEN', 'WETH', 'cbBTC'])
    expect(result.route.hops).toBe(2)

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log('Multi-hop: 1000 DEGEN → WETH → cbBTC =', result.tokenOut.amountOut, 'cbBTC')
  }, 15000)

  it('verifies Slipstream price calculation is reasonable', async () => {
    // Get quote from our tool
    const result = await getQuote('WETH', 'USDC', '1')
    expect(result.success).toBe(true)
    expect(result.poolType).toBe('slipstream')

    const amountOut = parseFloat(result.tokenOut.amountOut)

    // ETH price should be between $1000 and $10000 (sanity check)
    expect(amountOut).toBeGreaterThan(1000)
    expect(amountOut).toBeLessThan(10000)

    console.log('Price sanity check: 1 WETH =', amountOut.toFixed(2), 'USDC')
  }, 15000)
})

describe('Aerodrome Quote Tool - Invalid Via Parameter (LLM Hallucination Guard)', () => {
  it('ignores via parameter when via equals tokenOut (USDC→WETH via WETH)', async () => {
    // This is the exact bug from the logs: agent asked for USDC→WETH→WETH
    const result = await getQuote('USDC', 'WETH', '1000', 'WETH')

    // Should succeed by ignoring the invalid via and doing direct swap
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Should be a single-hop, not multi-hop
    expect(result.route.hops).toBe(1)
    expect(result.route.path).toEqual(['USDC', 'WETH'])

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log(`Via=tokenOut guard: 1000 USDC → WETH = ${amountOut} WETH (via ignored)`)
  }, 15000)

  it('ignores via parameter when via equals tokenIn (WETH→USDC via WETH)', async () => {
    const result = await getQuote('WETH', 'USDC', '1', 'WETH')

    // Should succeed by ignoring the invalid via and doing direct swap
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Should be a single-hop, not multi-hop
    expect(result.route.hops).toBe(1)
    expect(result.route.path).toEqual(['WETH', 'USDC'])

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log(`Via=tokenIn guard: 1 WETH → USDC = ${amountOut} USDC (via ignored)`)
  }, 15000)

  it('allows valid via parameter for actual multi-hop (DEGEN→WETH→cbBTC)', async () => {
    // This is a valid multi-hop: DEGEN has no direct pool to cbBTC
    const result = await getQuote('DEGEN', 'cbBTC', '1000', 'WETH')

    expect(result.success).toBe(true)
    expect(result.route.hops).toBe(2)
    expect(result.route.path).toEqual(['DEGEN', 'WETH', 'cbBTC'])

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log(`Valid multi-hop: 1000 DEGEN → WETH → cbBTC = ${amountOut} cbBTC`)
  }, 15000)
})
