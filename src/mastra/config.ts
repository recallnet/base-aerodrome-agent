import { ConsoleLogger } from '@mastra/core/logger'
import { Mastra } from '@mastra/core/mastra'

import { aerodromeAgent } from '../agents/trading.agent.js'

/**
 * Mastra Configuration
 *
 * This wires up the trading agent for:
 * - Studio UI (interactive chat, tool testing)
 * - REST API endpoints (programmatic access)
 *
 * Run with: pnpm mastra:dev
 * Studio available at: http://localhost:4111
 */
export const mastra = new Mastra({
  agents: {
    aerodromeTrader: aerodromeAgent,
  },
  logger: new ConsoleLogger({ name: 'AerodromeAgent', level: 'info' }),
  server: {
    // Higher maxSteps for Studio UI (default is 5, which cuts off swap executions)
    defaultGenerateOptions: {
      maxSteps: 20,
    },
  },
})
