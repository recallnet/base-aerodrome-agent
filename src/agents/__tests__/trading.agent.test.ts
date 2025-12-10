/**
 * Trading Agent - Integration Test
 * Verifies the inference provider (Anthropic Claude) is working correctly
 * Tests that the agent can call tools and reason about data
 *
 * SAFETY: The executeSwap tool is blocked in test mode via TEST_MODE env var.
 * Even if the agent tries to execute a swap, it will be blocked and return an error.
 */
import { describe, expect, it } from 'vitest'

import { executeSwapTool } from '../../tools/aerodrome/swap.tool'
import { aerodromeAgent } from '../trading.agent'

describe('Trading Agent - Safety Checks', () => {
  it('blocks swap execution via DRY_RUN by default', async () => {
    // DRY_RUN is set to true in .env.example and test setup
    // This provides safety in test environments

    // Try to execute a swap directly - should be blocked by DRY_RUN
    const result = await executeSwapTool.execute({
      context: {
        tokenIn: 'USDC',
        tokenOut: 'AERO',
        amountIn: '100',
        minAmountOut: '50',
        slippagePercent: 0.5,
      },
      runtimeContext: {} as never,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('DRY RUN')
    expect(result.error).toContain('NOT executed')

    console.log('Swap blocked with message:', result.error)
  })
})

describe('Trading Agent - Inference Provider', () => {
  it('responds to a simple query without tool calls', async () => {
    const response = await aerodromeAgent.generateLegacy(
      'What tokens can you help me trade on Aerodrome? Just list the token names, no need to check prices.',
      { maxSteps: 1 }
    )

    expect(response.text).toBeDefined()
    expect(response.text.length).toBeGreaterThan(0)

    // Should mention some tokens
    const text = response.text.toLowerCase()
    expect(
      text.includes('aero') ||
        text.includes('weth') ||
        text.includes('usdc') ||
        text.includes('eth')
    ).toBe(true)

    console.log('Agent response:', response.text.slice(0, 500))
  }, 30000)

  it('uses tools to gather data when asked about prices', async () => {
    const toolsCalled: string[] = []

    const response = await aerodromeAgent.generateLegacy(
      'What is the current price of AERO? Use your tools to check.',
      {
        maxSteps: 3,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls?.length) {
            toolsCalled.push(...toolCalls.map((t) => t.toolName))
          }
        },
      }
    )

    expect(response.text).toBeDefined()

    // Should have called getTokenPrice tool
    expect(toolsCalled).toContain('getTokenPrice')

    // Response should contain price information
    const text = response.text.toLowerCase()
    expect(text.includes('price') || text.includes('$') || text.includes('usd')).toBe(true)

    console.log('Tools called:', toolsCalled)
    console.log('Agent response:', response.text.slice(0, 500))
  }, 60000)

  it('checks wallet balance when asked about portfolio', async () => {
    const toolsCalled: string[] = []

    const response = await aerodromeAgent.generateLegacy(
      'What is my current wallet balance? Check my ETH and token balances.',
      {
        maxSteps: 3,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls?.length) {
            toolsCalled.push(...toolCalls.map((t) => t.toolName))
          }
        },
      }
    )

    expect(response.text).toBeDefined()

    // Should have called getWalletBalance tool
    expect(toolsCalled).toContain('getWalletBalance')

    console.log('Tools called:', toolsCalled)
    console.log('Agent response:', response.text.slice(0, 500))
  }, 60000)

  it('gathers multiple data sources for trading analysis', async () => {
    const toolsCalled: string[] = []

    const response = await aerodromeAgent.generateLegacy(
      'Analyze AERO/USDC for a potential trade. Check the price, pool metrics, and give me your analysis. Do NOT execute any trades.',
      {
        maxSteps: 5,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls?.length) {
            toolsCalled.push(...toolCalls.map((t) => t.toolName))
          }
        },
      }
    )

    expect(response.text).toBeDefined()

    // Should have called multiple tools for comprehensive analysis
    expect(toolsCalled.length).toBeGreaterThanOrEqual(2)

    // Should NOT have called executeSwap (we said don't trade)
    expect(toolsCalled).not.toContain('executeSwap')

    // Response should contain analysis/reasoning
    expect(response.text.length).toBeGreaterThan(100)

    console.log('Tools called:', toolsCalled)
    console.log('Agent response:', response.text.slice(0, 800))
  }, 90000)

  it('returns structured JSON decision when asked', async () => {
    const response = await aerodromeAgent.generateLegacy(
      `Based on the following hypothetical data, provide your trading decision as JSON:
      - AERO price: $1.50, up 5% in 24h
      - Pool liquidity: $10M
      - Sentiment: Moderately bullish
      - My balance: 1000 USDC
      
      Give me your decision in the JSON format from your output contract.`,
      { maxSteps: 1 }
    )

    expect(response.text).toBeDefined()

    // Should contain JSON structure
    expect(response.text.includes('reasoning') || response.text.includes('trade_decisions')).toBe(
      true
    )

    console.log('Agent JSON response:', response.text)
  }, 30000)
})
