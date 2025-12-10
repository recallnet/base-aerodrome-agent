#!/usr/bin/env node
/**
 * Aerodrome Trading Agent CLI
 *
 * Commands:
 * - health: Check system health and configuration
 * - analyze: Run a single analysis iteration (DRY_RUN mode, no trades)
 * - start: Start the autonomous trading loop
 * - recall-verify: Verify wallet ownership with Recall API (one-time)
 */
import { Command } from 'commander'
import 'dotenv/config'

import { healthCheck } from '../database/db.js'
import startApplication from '../index.js'
import { runSingleIteration } from '../loop/index.js'
import { verifyWalletOwnership } from '../services/recall-verifier.js'
import { validateRecallVerificationConfig, EIGENAI_CONFIG } from '../config/eigenai.js'
import { isWalletConfigured, getWalletAddress } from '../execution/wallet.js'
import { getCoinGeckoConfig } from '../config/index.js'

/** Options for the analyze command */
interface AnalyzeOptions {
  token: string
  base: string
}

/** Options for the start command */
interface StartOptions {
  dryRun: boolean
}

const program = new Command()

program
  .name('aerodrome-agent')
  .description('CLI for Aerodrome Trading Agent on Base chain')
  .version('1.0.0')

program
  .command('health')
  .description('Check system health and configuration')
  .action(async () => {
    console.log('🏥 Checking system health...\n')

    try {
      const dbHealthy = await healthCheck()

      console.log('=== Required ===')
      console.log(`📊 Database:       ${dbHealthy ? '✅ Connected' : '❌ Failed'}`)

      const useEigenAI = EIGENAI_CONFIG.enabled
      console.log(`🔀 EIGENAI_ENABLED: ${useEigenAI ? 'true' : 'false'}`)

      const anthropicStatus = process.env.ANTHROPIC_API_KEY ? '✅ Configured' : '❌ Missing'
      const eigenaiStatus = EIGENAI_CONFIG.grantWalletPrivateKey ? '✅ Configured' : '❌ Missing grant key'

      console.log(`🤖 Anthropic:      ${anthropicStatus} ${useEigenAI ? '(standby)' : '← active'}`)
      console.log(`🧠 EigenAI:        ${eigenaiStatus} ${useEigenAI ? '← active' : '(standby)'}`)

      console.log('\n=== Trading (optional) ===')
      console.log(
        `🔑 Wallet:         ${process.env.AGENT_PRIVATE_KEY ? '✅ Configured' : '⚠️  Not set (read-only mode)'}`
      )
      console.log(
        `🌐 Base RPC:       ${process.env.BASE_RPC_URL ? '✅ Configured' : '⚠️  Using default'}`
      )

      console.log('\n=== Data Sources (optional) ===')
      console.log(
        `📈 CoinGecko:      ${(() => {
          const cg = getCoinGeckoConfig()
          if (cg?.tier === 'pro') return '✅ Pro API'
          if (cg?.tier === 'demo') return '✅ Demo API'
          return '⚠️  Not set (no indicators)'
        })()}`
      )
      console.log(
        `🐦 Grok API:       ${process.env.GROK_API_KEY ? '✅ Configured' : '⚠️  Not set (no sentiment)'}`
      )

      console.log('\n=== Safety ===')
      const dryRun = process.env.DRY_RUN === 'true' || process.env.TEST_MODE === 'true'
      console.log(
        `🛡️  DRY_RUN mode:   ${dryRun ? '✅ ON (trades blocked)' : '⚠️  OFF (trades enabled!)'}`
      )
      console.log(`🌍 Environment:    ${process.env.NODE_ENV || 'development'}`)

      if (!dryRun && process.env.AGENT_PRIVATE_KEY) {
        console.log('\n⚠️  WARNING: Real trading is enabled! Trades WILL be executed.')
        console.log('   Set DRY_RUN=true to disable trading.')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('❌ Health check failed:', errorMessage)
    }
  })

program
  .command('analyze')
  .description('Run a single analysis iteration (DRY_RUN mode - no real trades)')
  .option('-t, --token <symbol>', 'Token to analyze', 'AERO')
  .option('-b, --base <symbol>', 'Base token', 'USDC')
  .action(async (options: AnalyzeOptions) => {
    // Force DRY_RUN mode for analyze command
    process.env.DRY_RUN = 'true'

    console.log('🔍 Running single analysis (DRY_RUN mode)...')
    console.log(`📊 Analyzing: ${options.token}/${options.base}\n`)

    try {
      const dbHealthy = await healthCheck()

      if (!dbHealthy) {
        console.error('❌ Database connection failed. Run: pnpm db:migrate')
        process.exit(1)
      }

      await runSingleIteration(options.token, options.base)

      console.log('\n✅ Analysis complete. No trades were executed (DRY_RUN mode).')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('❌ Analysis failed:', errorMessage)
      process.exit(1)
    }
  })

program
  .command('start')
  .description('Start the autonomous trading loop')
  .option('--dry-run', 'Run in DRY_RUN mode (no real trades)', false)
  .action(async (options: StartOptions) => {
    if (options.dryRun) {
      process.env.DRY_RUN = 'true'
      console.log('🛡️  DRY_RUN mode enabled - trades will be simulated\n')
    } else {
      console.log('⚠️  WARNING: Real trading mode! Trades WILL be executed.')
      console.log('   Use --dry-run flag to disable trading.\n')

      // Give user 5 seconds to cancel
      console.log('   Starting in 5 seconds... (Ctrl+C to cancel)')
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }

    try {
      await startApplication()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('❌ Failed to start:', errorMessage)
      process.exit(1)
    }
  })

program
  .command('recall-verify')
  .description('Verify wallet ownership with Recall API (one-time operation)')
  .action(async () => {
    console.log('🔐 Verifying wallet ownership with Recall API...\n')

    try {
      // 1. Validate configuration
      validateRecallVerificationConfig()

      if (!isWalletConfigured()) {
        throw new Error('AGENT_PRIVATE_KEY is required')
      }

      // 2. Display config status
      const walletAddress = getWalletAddress()
      console.log('✅ Configuration validated')
      console.log(`   - Recall API URL: ${EIGENAI_CONFIG.recallApiUrl}`)
      console.log(`   - Trading Wallet:  ${walletAddress}`)
      console.log()

      // 3. Run verification
      const result = await verifyWalletOwnership()

      // 4. Display results
      if (result.success) {
        console.log('✅ Wallet verified successfully!')
        console.log(`   - Wallet Address: ${result.walletAddress}`)
        console.log('   - Verified with Recall API ✓')
        console.log('\nYour wallet is now verified with Recall.')
      } else {
        throw new Error(result.error || 'Verification failed')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('❌ Wallet verification failed:', errorMessage)
      process.exit(1)
    }
  })

program.parse()
