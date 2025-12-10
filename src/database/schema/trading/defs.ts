/**
 * Aerodrome DEX Trading Schema
 *
 * Modeled after ai-trading-agent's diary.jsonl but with real database persistence.
 * Key tables:
 * - tradingDiary: Every decision the agent makes (like diary.jsonl)
 * - swapTransactions: Executed swaps with on-chain data
 * - portfolioSnapshots: Periodic balance snapshots for performance tracking
 * - eigenaiSignatures: Cryptographic signatures from EigenAI for verifiable inference
 */
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestampColumns, uuidColumn } from '../util'

/**
 * Trading Diary
 * Records every decision the agent makes - whether executed or not.
 * This is the primary context for retrospective analysis.
 *
 * Analogous to diary.jsonl in ai-trading-agent
 */
export const tradingDiary = pgTable(
  'trading_diary',
  {
    id: uuidColumn(),

    // Iteration context
    iterationNumber: integer('iteration_number').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),

    // Token pair
    tokenIn: text('token_in').notNull(), // e.g., "WETH"
    tokenOut: text('token_out').notNull(), // e.g., "AERO"

    // Decision
    action: text('action', { enum: ['BUY', 'SELL', 'HOLD'] }).notNull(),

    // Amounts (null if HOLD)
    amountIn: decimal('amount_in', { precision: 36, scale: 18 }),
    amountOut: decimal('amount_out', { precision: 36, scale: 18 }),
    amountUsd: decimal('amount_usd', { precision: 18, scale: 2 }),

    // Prices at time of decision
    priceAtDecision: decimal('price_at_decision', { precision: 36, scale: 18 }),

    // Agent reasoning (critical for retrospective analysis)
    reasoning: text('reasoning').notNull(),
    rationale: text('rationale'), // Short summary

    // Data the agent saw when making this decision
    contextSnapshot: jsonb('context_snapshot'), // Market data, sentiment, etc.

    // Execution status
    executed: boolean('executed').notNull().default(false),
    txHash: text('tx_hash'),
    executionError: text('execution_error'),

    // Outcome tracking (filled in later for retrospective)
    priceAfter1h: decimal('price_after_1h', { precision: 36, scale: 18 }),
    priceAfter4h: decimal('price_after_4h', { precision: 36, scale: 18 }),
    priceAfter24h: decimal('price_after_24h', { precision: 36, scale: 18 }),
    outcomeNotes: text('outcome_notes'), // Agent's retrospective assessment

    ...timestampColumns(),
  },
  (table) => [
    index('idx_diary_timestamp').on(table.timestamp),
    index('idx_diary_iteration').on(table.iterationNumber),
    index('idx_diary_token_pair').on(table.tokenIn, table.tokenOut),
    index('idx_diary_action').on(table.action),
    index('idx_diary_executed').on(table.executed),
  ]
)

/**
 * Swap Transactions
 * Records executed swaps with on-chain data for accurate PnL tracking.
 */
export const swapTransactions = pgTable(
  'swap_transactions',
  {
    id: uuidColumn(),

    // Link to diary entry
    diaryId: uuid('diary_id').references(() => tradingDiary.id),

    // Transaction data
    txHash: text('tx_hash').notNull().unique(),
    blockNumber: integer('block_number'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),

    // Swap details
    tokenIn: text('token_in').notNull(),
    tokenInAddress: text('token_in_address').notNull(),
    amountIn: decimal('amount_in', { precision: 36, scale: 18 }).notNull(),
    amountInUsd: decimal('amount_in_usd', { precision: 18, scale: 2 }),

    tokenOut: text('token_out').notNull(),
    tokenOutAddress: text('token_out_address').notNull(),
    amountOut: decimal('amount_out', { precision: 36, scale: 18 }).notNull(),
    amountOutUsd: decimal('amount_out_usd', { precision: 18, scale: 2 }),

    // Execution details
    poolAddress: text('pool_address'),
    isStablePool: boolean('is_stable_pool'),
    slippagePercent: decimal('slippage_percent', { precision: 8, scale: 4 }),

    // Gas costs
    gasUsed: integer('gas_used'),
    gasPriceGwei: decimal('gas_price_gwei', { precision: 12, scale: 4 }),
    gasCostUsd: decimal('gas_cost_usd', { precision: 10, scale: 4 }),

    // Status
    status: text('status', { enum: ['SUCCESS', 'FAILED', 'REVERTED'] }).notNull(),
    errorMessage: text('error_message'),

    ...timestampColumns(),
  },
  (table) => [
    index('idx_swaps_timestamp').on(table.timestamp),
    index('idx_swaps_tokens').on(table.tokenIn, table.tokenOut),
    index('idx_swaps_status').on(table.status),
  ]
)

/**
 * Portfolio Snapshots
 * Periodic snapshots of wallet balances for performance tracking.
 */
export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuidColumn(),

    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    iterationNumber: integer('iteration_number'),

    // Balances as JSONB for flexibility
    // Format: { "ETH": "1.5", "WETH": "0.5", "USDC": "1000", "AERO": "500" }
    balances: jsonb('balances').notNull(),

    // Computed totals
    totalValueUsd: decimal('total_value_usd', { precision: 18, scale: 2 }),

    // Performance since start
    startingValueUsd: decimal('starting_value_usd', { precision: 18, scale: 2 }),
    pnlUsd: decimal('pnl_usd', { precision: 18, scale: 2 }),
    pnlPercent: decimal('pnl_percent', { precision: 10, scale: 4 }),

    ...timestampColumns(),
  },
  (table) => [
    index('idx_snapshots_timestamp').on(table.timestamp),
    index('idx_snapshots_iteration').on(table.iterationNumber),
  ]
)

/**
 * Positions
 * Tracks current holdings with cost basis for P&L calculation.
 * Updated after each trade to maintain accurate cost basis.
 */
export const positions = pgTable(
  'positions',
  {
    id: uuidColumn(),

    // Token identification
    token: text('token').notNull().unique(), // Symbol like "AERO"
    tokenAddress: text('token_address').notNull(),

    // Current holdings
    balance: decimal('balance', { precision: 36, scale: 18 }).notNull().default('0'),

    // Cost basis tracking (average cost method)
    totalCostUsd: decimal('total_cost_usd', { precision: 18, scale: 2 }).notNull().default('0'),
    averageCostPerToken: decimal('average_cost_per_token', { precision: 36, scale: 18 }),

    // Trade statistics
    totalBought: decimal('total_bought', { precision: 36, scale: 18 }).notNull().default('0'),
    totalSold: decimal('total_sold', { precision: 36, scale: 18 }).notNull().default('0'),
    totalBuyCostUsd: decimal('total_buy_cost_usd', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    totalSellProceedsUsd: decimal('total_sell_proceeds_usd', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    realizedPnlUsd: decimal('realized_pnl_usd', { precision: 18, scale: 2 }).notNull().default('0'),

    // Trade count
    buyCount: integer('buy_count').notNull().default(0),
    sellCount: integer('sell_count').notNull().default(0),

    // First and last trade timestamps
    firstTradeAt: timestamp('first_trade_at', { withTimezone: true }),
    lastTradeAt: timestamp('last_trade_at', { withTimezone: true }),

    ...timestampColumns(),
  },
  (table) => [
    index('idx_positions_token').on(table.token),
    index('idx_positions_balance').on(table.balance),
  ]
)

/**
 * Price History Cache
 * Caches token prices for retrospective analysis without hitting external APIs.
 */
export const priceHistory = pgTable(
  'price_history',
  {
    id: uuidColumn(),

    token: text('token').notNull(), // Symbol like "AERO"
    tokenAddress: text('token_address').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),

    priceUsd: decimal('price_usd', { precision: 36, scale: 18 }).notNull(),
    volume24hUsd: decimal('volume_24h_usd', { precision: 18, scale: 2 }),
    liquidityUsd: decimal('liquidity_usd', { precision: 18, scale: 2 }),

    source: text('source').notNull().default('dexscreener'),

    ...timestampColumns(),
  },
  (table) => [
    index('idx_prices_token_timestamp').on(table.token, table.timestamp),
    index('idx_prices_timestamp').on(table.timestamp),
  ]
)

/**
 * EigenAI Signatures
 * Records cryptographic signatures from EigenAI dTERMinal API responses.
 * Used for verifiable AI inference and Recall API submission.
 */
export const eigenaiSignatures = pgTable(
  'eigenai_signatures',
  {
    id: uuidColumn(),

    // Link to trading iteration
    iterationNumber: integer('iteration_number').notNull(),
    diaryId: uuid('diary_id').references(() => tradingDiary.id),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),

    // Signature data from EigenAI response
    signature: text('signature').notNull(), // ECDSA signature (hex)
    modelId: text('model_id').notNull(), // e.g., "gpt-oss-120b-f16"

    // Audit hashes (for verification without storing full request/response)
    requestHash: text('request_hash').notNull(), // keccak256 of prompt
    responseHash: text('response_hash').notNull(), // keccak256 of output

    // Local verification results
    localVerificationStatus: text('local_verification_status', {
      enum: ['pending', 'verified', 'invalid', 'error'],
    })
      .notNull()
      .default('pending'),
    recoveredSigner: text('recovered_signer'), // Address recovered from signature
    expectedSigner: text('expected_signer'), // Expected signer address
    verificationError: text('verification_error'), // Error message if verification failed

    // Recall API submission tracking
    submittedToRecall: boolean('submitted_to_recall').notNull().default(false),
    recallSubmissionId: text('recall_submission_id'), // ID returned by Recall API
    recallSubmittedAt: timestamp('recall_submitted_at', { withTimezone: true }),
    recallVerificationStatus: text('recall_verification_status', {
      enum: ['pending', 'verified', 'rejected', 'error'],
    }),
    recallError: text('recall_error'),

    ...timestampColumns(),
  },
  (table) => [
    index('idx_eigenai_iteration').on(table.iterationNumber),
    index('idx_eigenai_timestamp').on(table.timestamp),
    index('idx_eigenai_local_status').on(table.localVerificationStatus),
    index('idx_eigenai_recall_status').on(table.submittedToRecall),
  ]
)
