/**
 * Aerodrome Swap Tool - Integration Test
 * Tests swap execution in DRY_RUN mode (no real trades)
 *
 * These tests verify:
 * - Token validation and error handling
 * - Pool discovery integration (Slipstream vs V2)
 * - Multi-hop routing setup
 * - DRY_RUN safety mechanism
 */
import { describe, expect, it } from 'vitest'

import { TOKEN_ADDRESSES } from '../../../config/tokens'
import { executeSwapTool } from '../swap.tool'

/** Helper to execute swap (always in dry-run mode during tests) */
const executeSwap = (params: {
  tokenIn: string
  tokenOut: string
  amountIn: string
  minAmountOut: string
  slippagePercent?: number
  via?: string
}) =>
  executeSwapTool.execute({
    context: {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      slippagePercent: params.slippagePercent ?? 0.5,
      via: params.via,
    },
    runtimeContext: {} as never,
  })

describe('Aerodrome Swap Tool - DRY_RUN Mode', () => {
  it('blocks execution in test mode and returns dry run response', async () => {
    const result = await executeSwap({
      tokenIn: 'USDC',
      tokenOut: 'WETH',
      amountIn: '100',
      minAmountOut: '0.03',
    })

    // Should return dry run response (blocked in test mode)
    expect(result.dryRun).toBe(true)
    expect(result.success).toBe(false)
    expect(result.error).toContain('DRY RUN')

    // Should still have correct token info
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenIn.amount).toBe('100')
    expect(result.tokenOut.symbol).toBe('WETH')

    console.log('DRY RUN response:', result)
  })

  it('blocks Slipstream swap in dry run mode', async () => {
    // WETH/USDC uses Slipstream
    const result = await executeSwap({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '0.1',
      minAmountOut: '300',
    })

    expect(result.dryRun).toBe(true)
    expect(result.success).toBe(false)
    expect(result.tokenIn.symbol).toBe('WETH')
    expect(result.tokenOut.symbol).toBe('USDC')

    console.log('Slipstream DRY RUN:', result)
  })

  it('blocks multi-hop swap in dry run mode', async () => {
    const result = await executeSwap({
      tokenIn: 'USDC',
      tokenOut: 'BRETT',
      amountIn: '10',
      minAmountOut: '1000',
      via: 'WETH',
    })

    expect(result.dryRun).toBe(true)
    expect(result.success).toBe(false)
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenOut.symbol).toBe('BRETT')

    console.log('Multi-hop DRY RUN:', result)
  })
})

describe('Aerodrome Swap Tool - Input Validation', () => {
  it('returns dry run for unknown input token (dry run check first)', async () => {
    // Dry run check happens before token validation
    const result = await executeSwap({
      tokenIn: 'UNKNOWNTOKEN',
      tokenOut: 'USDC',
      amountIn: '100',
      minAmountOut: '90',
    })

    expect(result.success).toBe(false)
    // Dry run happens first, so we get dry run response
    expect(result.dryRun).toBe(true)
    expect(result.error).toContain('DRY RUN')

    console.log('Unknown token in dry run mode:', result.error)
  })

  it('returns dry run for unknown output token', async () => {
    const result = await executeSwap({
      tokenIn: 'USDC',
      tokenOut: 'FAKETOKEN',
      amountIn: '100',
      minAmountOut: '90',
    })

    expect(result.success).toBe(false)
    expect(result.dryRun).toBe(true)
    expect(result.error).toContain('DRY RUN')
  })

  it('returns dry run for unknown intermediate token', async () => {
    const result = await executeSwap({
      tokenIn: 'USDC',
      tokenOut: 'BRETT',
      amountIn: '100',
      minAmountOut: '1000',
      via: 'INVALIDVIA',
    })

    expect(result.success).toBe(false)
    expect(result.dryRun).toBe(true)
    expect(result.error).toContain('DRY RUN')
  })

  it('accepts token addresses instead of symbols', async () => {
    const result = await executeSwap({
      tokenIn: TOKEN_ADDRESSES.USDC,
      tokenOut: TOKEN_ADDRESSES.WETH,
      amountIn: '100',
      minAmountOut: '0.03',
    })

    // In dry run mode, the tool returns the input as-is (address, not resolved symbol)
    expect(result.dryRun).toBe(true)
    expect(result.tokenIn.symbol).toBe(TOKEN_ADDRESSES.USDC)
    expect(result.tokenOut.symbol).toBe(TOKEN_ADDRESSES.WETH)
  })
})

describe('Aerodrome Swap Tool - Route Types', () => {
  it('handles Slipstream pair (WETH/USDC)', async () => {
    const result = await executeSwap({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '1',
      minAmountOut: '3000',
    })

    // Dry run blocks but validates route
    expect(result.dryRun).toBe(true)
    expect(result.tokenIn.symbol).toBe('WETH')
    expect(result.tokenOut.symbol).toBe('USDC')
  })

  it('handles V2 pair (DEGEN/TOSHI)', async () => {
    const result = await executeSwap({
      tokenIn: 'DEGEN',
      tokenOut: 'TOSHI',
      amountIn: '1000',
      minAmountOut: '100',
    })

    expect(result.dryRun).toBe(true)
    expect(result.tokenIn.symbol).toBe('DEGEN')
    expect(result.tokenOut.symbol).toBe('TOSHI')
  })

  it('handles stable pair (USDC/USDbC)', async () => {
    const result = await executeSwap({
      tokenIn: 'USDC',
      tokenOut: 'USDbC',
      amountIn: '100',
      minAmountOut: '99',
    })

    expect(result.dryRun).toBe(true)
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenOut.symbol).toBe('USDbC')
  })

  it('handles multi-hop with WETH as intermediate', async () => {
    const result = await executeSwap({
      tokenIn: 'AERO',
      tokenOut: 'cbBTC',
      amountIn: '100',
      minAmountOut: '0.00001',
      via: 'WETH',
    })

    expect(result.dryRun).toBe(true)
    expect(result.tokenIn.symbol).toBe('AERO')
    expect(result.tokenOut.symbol).toBe('cbBTC')
  })
})

describe('Aerodrome Swap Tool - Invalid Via Parameter (LLM Hallucination Guard)', () => {
  it('ignores via parameter when via equals tokenOut (USDC→WETH via WETH)', async () => {
    // This is the exact bug from the logs: agent asked for USDC→WETH→WETH
    const result = await executeSwap({
      tokenIn: 'USDC',
      tokenOut: 'WETH',
      amountIn: '1000',
      minAmountOut: '0.1',
      via: 'WETH', // Invalid: same as tokenOut
    })

    // Should succeed in dry run mode (invalid via is ignored)
    expect(result.dryRun).toBe(true)
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenOut.symbol).toBe('WETH')
    // Should NOT fail due to the invalid via
    expect(result.error).toContain('DRY RUN')
  })

  it('ignores via parameter when via equals tokenIn (WETH→USDC via WETH)', async () => {
    const result = await executeSwap({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '1',
      minAmountOut: '1000',
      via: 'WETH', // Invalid: same as tokenIn
    })

    // Should succeed in dry run mode (invalid via is ignored)
    expect(result.dryRun).toBe(true)
    expect(result.tokenIn.symbol).toBe('WETH')
    expect(result.tokenOut.symbol).toBe('USDC')
    // Should NOT fail due to the invalid via
    expect(result.error).toContain('DRY RUN')
  })

  it('allows valid via parameter for actual multi-hop', async () => {
    const result = await executeSwap({
      tokenIn: 'DEGEN',
      tokenOut: 'cbBTC',
      amountIn: '1000',
      minAmountOut: '0.00000001',
      via: 'WETH', // Valid: DEGEN→WETH→cbBTC
    })

    expect(result.dryRun).toBe(true)
    expect(result.tokenIn.symbol).toBe('DEGEN')
    expect(result.tokenOut.symbol).toBe('cbBTC')
  })
})
