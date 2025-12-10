/**
 * Aerodrome Quote Tool - Integration Test
 * Calls actual Aerodrome Router contract on Base chain
 */
import { describe, expect, it } from 'vitest'

import { TOKEN_ADDRESSES } from '@/config/tokens'

import { getQuoteTool } from '../quote.tool'

/** Helper for single-hop quotes */
const getQuote = (tokenIn: string, tokenOut: string, amountIn: string) =>
  getQuoteTool.execute({
    context: { tokenIn, tokenOut, amountIn },
    runtimeContext: {} as never,
  })

/** Helper for multi-hop quotes */
const getMultiHopQuote = (tokenIn: string, tokenOut: string, amountIn: string, via: string) =>
  getQuoteTool.execute({
    context: { tokenIn, tokenOut, amountIn, via },
    runtimeContext: {} as never,
  })

describe('Aerodrome Quote Tool', () => {
  it('gets quote for USDC -> AERO (volatile pool)', async () => {
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

    // Route should be volatile (USDC/AERO is not stable pair)
    expect(result.route.stable).toBe(false)
    expect(result.route.path).toEqual(['USDC', 'AERO'])

    console.log('100 USDC =', result.tokenOut.amountOut, 'AERO')
  }, 15000)

  it('gets quote for WETH -> USDC (volatile pool)', async () => {
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
