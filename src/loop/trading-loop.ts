/**
 * Aerodrome Trading Loop
 *
 * Simple loop that:
 * 1. Gets recent trading history from diary (for context)
 * 2. Calls agent.generate() and lets the agent iterate
 * 3. Logs every decision to the diary
 *
 * Pattern from aerodrome-mastra-implementation-guide.md:
 * > Don't build a workflow that calls tools in sequence.
 * > Build an agent that reasons about which tools it needs.
 */
import { aerodromeAgent } from '../agents/trading.agent.js'
import { EIGENAI_CONFIG } from '../config/eigenai.js'
import { DEFAULT_TRADING_PAIRS, TRADING_CONFIG } from '../config/index.js'
import { eigenaiSignaturesRepo, tradingDiaryRepo } from '../database/repositories/index.js'
import type { DiaryEntryForContext } from '../database/schema/trading/types.js'
import {
  isEigenAIEnabled,
  processAndVerifyLastResponse,
} from '../eigenai/index.js'
import { getAllBalances } from '../execution/wallet.js'
import { performanceTracker } from '../services/performance-tracker.js'

/** DexScreener API response type */
interface DexScreenerResponse {
  pairs?: Array<{
    chainId: string
    priceUsd?: string
    liquidity?: { usd?: number }
  }>
}

/**
 * Fetch current USD price for a token from DexScreener
 */
async function fetchTokenPriceUsd(tokenAddress: string): Promise<number> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)
    if (!response.ok) return 0

    const data = (await response.json()) as DexScreenerResponse

    if (data.pairs && data.pairs.length > 0) {
      const basePairs = data.pairs.filter((p) => p.chainId === 'base')
      if (basePairs.length === 0) return 0

      const bestPair = basePairs.sort(
        (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0]

      return parseFloat(bestPair.priceUsd || '0')
    }
    return 0
  } catch {
    return 0
  }
}

/**
 * Take a portfolio snapshot at the start of each iteration
 * Records current balances and total value for performance tracking
 */
async function takePortfolioSnapshot(iterationNumber: number): Promise<void> {
  try {
    const tokenBalances = await getAllBalances()

    // Calculate total value in USD
    let totalValueUsd = 0
    const balanceRecord: Record<string, string> = {}

    for (const tb of tokenBalances) {
      const balanceNum = parseFloat(tb.balanceFormatted)
      if (balanceNum <= 0) continue

      balanceRecord[tb.symbol] = tb.balanceFormatted

      const priceUsd = await fetchTokenPriceUsd(tb.address)
      totalValueUsd += balanceNum * priceUsd
    }

    await performanceTracker.createSnapshot(balanceRecord, totalValueUsd, iterationNumber)
    console.log(`📸 Portfolio snapshot: $${totalValueUsd.toFixed(2)} total value`)
  } catch (error) {
    console.error('Failed to take portfolio snapshot:', error)
  }
}

/**
 * Context provided to the agent for each trading iteration
 */
interface TradingContext {
  targetToken: string
  baseToken: string
  timestamp: string
  iterationNumber: number
  recentHistory: DiaryEntryForContext[]
}

/**
 * Format recent history for agent context
 */
function formatHistoryForAgent(history: DiaryEntryForContext[]): string {
  if (history.length === 0) {
    return 'No previous trading history.'
  }

  return history
    .map((entry) => {
      let line = `[${entry.timestamp}] ${entry.tokenPair}: ${entry.action}`
      if (entry.amountUsd) {
        line += ` $${entry.amountUsd}`
      }
      if (entry.executed) {
        line += ` (executed)`
      }
      if (entry.outcome?.priceAfter1h) {
        line += ` | 1h later: $${entry.outcome.priceAfter1h}`
      }
      return line
    })
    .join('\n')
}

/**
 * Run a single trading iteration for a token pair
 * Agent gathers data and makes decisions autonomously
 */
export async function runTradingIteration(ctx: TradingContext): Promise<void> {
  console.log(
    `\n🤖 Trading iteration #${ctx.iterationNumber} for ${ctx.targetToken}/${ctx.baseToken}`
  )
  console.log(`📅 ${ctx.timestamp}`)

  const historyContext = formatHistoryForAgent(ctx.recentHistory)

  const prompt = `
Analyze ${ctx.targetToken}/${ctx.baseToken} on Aerodrome DEX.

Current time: ${ctx.timestamp}
Iteration: #${ctx.iterationNumber}

## Recent Trading History
${historyContext}

## Your Task
Use your tools to gather data and decide whether to BUY ${ctx.targetToken}, SELL ${ctx.targetToken} (if you hold any), or HOLD.

Suggested workflow:
1. Check wallet balance to see what you have
2. Get current token prices
3. Check pool liquidity depth
4. Get sentiment observations (if available)
5. If considering a trade, get a swap quote

Then analyze all the data and make your decision.

Return your decision as JSON with this structure:
{
  "reasoning": "your detailed analysis...",
  "trade_decisions": [{
    "token": "${ctx.targetToken}",
    "action": "BUY" | "SELL" | "HOLD",
    "amount_usd": 0,
    "rationale": "brief reason"
  }]
}
`

  let diaryId: string | null = null
  let responseText = ''

  try {
    const response = await aerodromeAgent.generate(prompt, {
      maxSteps: TRADING_CONFIG.maxAgentSteps,
      onStepFinish: ({ toolCalls }) => {
        if (toolCalls?.length) {
          const toolNames = toolCalls.map((t) => t.payload.toolName).join(', ')
          console.log(`  📞 Agent called: ${toolNames}`)
        }
      },
    })

    responseText = response.text
    console.log(`\n📊 Agent Response:\n${responseText}`)

    // If EigenAI is enabled, capture and verify signature
    if (isEigenAIEnabled()) {
      try {
        const signatureData = await processAndVerifyLastResponse(ctx.iterationNumber)
        if (signatureData) {
          // Store signature in database
          await eigenaiSignaturesRepo.createSignature({
            iterationNumber: ctx.iterationNumber,
            signature: signatureData.signature,
            modelId: signatureData.modelId,
            requestHash: signatureData.requestHash,
            responseHash: signatureData.responseHash,
            localVerificationStatus: signatureData.localVerificationStatus as 'verified' | 'invalid' | 'error',
            recoveredSigner: signatureData.recoveredSigner,
            expectedSigner: EIGENAI_CONFIG.expectedSigner,
            verificationError: signatureData.verificationError,
            submittedToRecall: false,
          })
          console.log(`🔐 EigenAI signature captured and ${signatureData.localVerificationStatus}`)
        }
      } catch (sigError) {
        console.warn(`⚠️ Failed to capture EigenAI signature: ${sigError}`)
      }
    }

    // Parse the agent's decision and log to diary
    const decision = parseAgentDecision(responseText)

    if (decision) {
      const entry = await tradingDiaryRepo.logDecision({
        iterationNumber: ctx.iterationNumber,
        timestamp: new Date(ctx.timestamp),
        tokenIn: ctx.baseToken,
        tokenOut: ctx.targetToken,
        action: decision.action as 'BUY' | 'SELL' | 'HOLD',
        amountUsd: decision.amountUsd?.toString(),
        reasoning: decision.reasoning,
        rationale: decision.rationale,
        executed: false,
      })
      diaryId = entry.id
      console.log(`📝 Logged decision to diary: ${diaryId}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`❌ Iteration error: ${errorMessage}`)

    // Log failed iteration
    await tradingDiaryRepo.logDecision({
      iterationNumber: ctx.iterationNumber,
      timestamp: new Date(ctx.timestamp),
      tokenIn: ctx.baseToken,
      tokenOut: ctx.targetToken,
      action: 'HOLD',
      reasoning: `Error during iteration: ${errorMessage}`,
      executed: false,
      executionError: errorMessage,
    })
  }
}

/**
 * Expected structure of agent's JSON response
 */
interface AgentDecisionResponse {
  reasoning?: string
  trade_decisions?: Array<{
    token?: string
    action?: string
    amount_usd?: number
    rationale?: string
  }>
}

/**
 * Parse the agent's JSON decision from response text
 */
function parseAgentDecision(responseText: string): {
  reasoning: string
  action: string
  amountUsd?: number
  rationale?: string
} | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as AgentDecisionResponse

    if (parsed.trade_decisions && parsed.trade_decisions.length > 0) {
      const firstDecision = parsed.trade_decisions[0]
      return {
        reasoning: parsed.reasoning ?? '',
        action: firstDecision?.action?.toUpperCase() ?? 'HOLD',
        amountUsd: firstDecision?.amount_usd,
        rationale: firstDecision?.rationale,
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Main autonomous trading loop
 * Runs continuously, processing each configured pair
 */
export async function startTradingLoop(): Promise<void> {
  console.log('🚀 Starting Aerodrome Trading Loop')
  console.log(`⏱️  Interval: ${TRADING_CONFIG.iterationIntervalMs / 60000} minutes`)
  console.log(`🎯 Pairs: ${DEFAULT_TRADING_PAIRS.map((p) => `${p.quote}/${p.base}`).join(', ')}`)

  // Get starting iteration number from database
  let iterationNumber = await tradingDiaryRepo.getCurrentIterationNumber()

  const runIteration = async () => {
    iterationNumber++
    const timestamp = new Date().toISOString()

    console.log(`\n${'='.repeat(60)}`)
    console.log(`📈 Trading Iteration #${iterationNumber}`)
    console.log(`${'='.repeat(60)}`)

    // Take portfolio snapshot for performance tracking
    await takePortfolioSnapshot(iterationNumber)

    // Get recent history for context (last 20 decisions)
    const recentHistory = await tradingDiaryRepo.getRecentEntries(20)
    console.log(`📚 Loaded ${recentHistory.length} recent decisions for context`)

    for (const pair of DEFAULT_TRADING_PAIRS) {
      // Get pair-specific history
      const pairHistory = await tradingDiaryRepo.getRecentEntriesForPair(pair.base, pair.quote, 10)

      await runTradingIteration({
        targetToken: pair.quote,
        baseToken: pair.base,
        timestamp,
        iterationNumber,
        recentHistory: pairHistory.length > 0 ? pairHistory : recentHistory,
      })

      // Small delay between pairs to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    console.log(`\n✅ Iteration #${iterationNumber} complete`)
    console.log(`⏳ Next iteration in ${TRADING_CONFIG.iterationIntervalMs / 60000} minutes...`)
  }

  // Run first iteration immediately
  await runIteration()

  // Schedule recurring iterations
  setInterval(runIteration, TRADING_CONFIG.iterationIntervalMs)
}

/**
 * Run a single iteration (for testing/CLI)
 */
export async function runSingleIteration(targetToken: string, baseToken: string): Promise<void> {
  const recentHistory = await tradingDiaryRepo.getRecentEntriesForPair(baseToken, targetToken, 10)

  await runTradingIteration({
    targetToken,
    baseToken,
    timestamp: new Date().toISOString(),
    iterationNumber: (await tradingDiaryRepo.getCurrentIterationNumber()) + 1,
    recentHistory,
  })
}
