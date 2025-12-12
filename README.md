# AI Trading Agent for Aerodrome DEX | Autonomous DeFi Trading on Base

An autonomous spot trading agent for [Aerodrome DEX](https://aerodrome.finance/) on Base chain, built with the [Mastra](https://mastra.ai) AI framework.

## 🎯 What This Does

This agent autonomously trades tokens on Aerodrome DEX by:

1. **Gathering data** - Token prices, pool liquidity, technical indicators, X/Twitter sentiment
2. **Reasoning about it** - The AI agent interprets what the data means
3. **Making decisions** - BUY, SELL, or HOLD based on its analysis
4. **Executing trades** - Swaps tokens on Aerodrome when confident
5. **Learning from outcomes** - Logs decisions and tracks retrospective performance

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your values

# Setup database
pnpm db:migrate

# Check everything is configured
pnpm cli health

# Run a single analysis (safe - no trades)
pnpm cli analyze

# Start the trading loop (safe - no trades)
pnpm cli start --dry-run
```

## ⚠️ Safety: DRY_RUN Mode

**By default, the agent CAN execute real trades.** Use these safety controls:

| Command | Trades? | Use Case |
|---------|---------|----------|
| `pnpm cli health` | ❌ No | Check configuration |
| `pnpm cli analyze` | ❌ No | Single analysis (forces DRY_RUN) |
| `pnpm cli start --dry-run` | ❌ No | Full loop, simulated trades |
| `pnpm cli start` | ✅ **YES** | Real trading (5s warning) |

### Environment Variables for Safety

```bash
# Set either of these to block all trades
DRY_RUN=true
TEST_MODE=true
```

When trades are blocked, the swap tool returns:
```
DRY RUN: Trade was simulated but NOT executed. Set DRY_RUN=false to enable real trades.
```

## 🧠 Architecture: The Agentic Pattern

This project follows the **correct agentic pattern** where the LLM does the work, not hardcoded logic:

```
┌─────────────────────────────────────────────────────────────┐
│                     TRADING LOOP                            │
├─────────────────────────────────────────────────────────────┤
│  1. Load recent trading history from database               │
│  2. Call agent.generate() with context                      │
│  3. Agent calls tools iteratively until confident           │
│  4. Agent returns decision (BUY/SELL/HOLD)                  │
│  5. Log decision to database                                │
│  6. Execute swap if BUY/SELL (unless DRY_RUN)               │
│  7. Wait for next iteration                                 │
└─────────────────────────────────────────────────────────────┘
```

**Key principle**: Tools return **raw data**. The agent **interprets** what it means.

### Tools (Data Gathering)

| Tool                  | Purpose                       | Returns                     |
| --------------------- | ----------------------------- | --------------------------- |
| `getIndicators`       | Technical analysis            | EMA, RSI, MACD, ATR, VWAP + market metrics |
| `getQuote`            | Swap quotes from Aerodrome    | Input/output amounts, route. Supports multi-hop via `via` param |
| `getPoolMetrics`      | Pool reserves and config      | Raw reserves, stable flag   |
| `getTokenPrice`       | Token prices from DexScreener | Price, 24h change, volume   |
| `getWalletBalance`    | Current wallet balances       | ETH and token amounts       |
| `getTwitterSentiment` | X/Twitter observations        | Themes, sentiment velocity  |
| `getPerformance`      | Portfolio P&L tracking        | Realized/unrealized P&L, positions |
| `executeSwap`         | Execute trades                | Transaction hash, status. Supports multi-hop via `via` param |

### Database (Persistence)

| Table                 | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `trading_diary`       | Every decision with reasoning (like diary.jsonl) |
| `swap_transactions`   | Executed swaps with on-chain data                |
| `positions`           | Current holdings with cost basis for P&L         |
| `portfolio_snapshots` | Balance history for performance tracking         |
| `price_history`       | Cached prices for retrospective analysis         |
| `eigenai.inferences`  | EigenAI verification data (when using EigenAI)   |

### Portfolio Performance Tracking

The agent tracks its own trading performance with cost-basis accounting:

- **Cost Basis**: Records purchase price for every buy, calculates weighted average cost
- **Realized P&L**: When selling, calculates actual profit/loss vs cost basis
- **Unrealized P&L**: Current holdings valued at market price vs cost basis
- **Portfolio Snapshots**: Periodic snapshots of total portfolio value over time

The agent can query its performance via the `getPerformance` tool to inform trading decisions.

### Multi-Hop Routing

The agent can route trades through intermediate tokens in a single atomic transaction:

```
USDC → WETH → BRETT  (instead of two separate swaps)
```

**How to use:**
```typescript
// Get quote with intermediate token
getQuote({ tokenIn: "USDC", tokenOut: "BRETT", amountIn: "10", via: "WETH" })

// Execute multi-hop swap
executeSwap({ tokenIn: "USDC", tokenOut: "BRETT", amountIn: "10", minAmountOut: "1000", via: "WETH" })
```

**Benefits:**
- **Lower gas** - Single transaction instead of two
- **Atomic execution** - Either the whole route succeeds or fails
- **Better routing** - Access tokens that don't have direct USDC pools

### Position Tracking

The agent tracks positions for all **volatile assets** (WETH, AERO, BRETT, etc.) but not for **stablecoins** (USDC, DAI) since they don't have meaningful P&L:

| Asset Type | Examples | Position Tracked? |
|------------|----------|-------------------|
| Volatile   | WETH, AERO, BRETT | ✅ Yes - cost basis and P&L |
| Stablecoin | USDC, USDbC, DAI | ❌ No - always ~$1 |

## 📁 Project Structure

```
src/
├── agents/
│   └── trading.agent.ts    # Single autonomous agent with system prompt
├── tools/
│   ├── aerodrome/          # DEX tools (quote, pool, swap)
│   ├── market/             # Price, balance, and indicators tools
│   ├── portfolio/          # Performance tracking tool
│   └── sentiment/          # X/Twitter sentiment tool
├── services/
│   └── performance-tracker.ts  # Cost basis and P&L calculations
├── lib/
│   └── llm/                # LLM provider abstraction
│       ├── providers/      # Custom providers (EigenAI)
│       ├── gateways/       # Mastra gateway implementations
│       └── index.ts        # Unified getModel() interface
├── loop/
│   └── trading-loop.ts     # Simple loop calling agent.generate()
├── database/
│   ├── schema/trading/     # Drizzle schema for trading data
│   ├── schema/eigenai/     # EigenAI verification data schema
│   └── repositories/       # Data access methods
├── config/
│   ├── tokens.ts           # Token addresses and metadata
│   └── contracts.ts        # Aerodrome contract ABIs
├── execution/
│   └── wallet.ts           # Wallet and signing utilities (Alchemy SDK)
├── cli/
│   └── index.ts            # CLI commands (health, analyze, start)
├── env.ts                  # Environment loader (must import first)
└── index.ts                # Application entry point
```

## 🔧 Configuration

Create a `.env` file:

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# LLM Provider (pick one)
LLM_PROVIDER=anthropic   # Options: anthropic | openai | eigenai

# Provider API Keys (based on LLM_PROVIDER choice)
ANTHROPIC_API_KEY=sk-ant-...     # For Anthropic
OPENAI_API_KEY=sk-...            # For OpenAI
EIGENAI_API_KEY=...              # For EigenAI (simple auth)
# OR
EIGENAI_PRIVATE_KEY=0x...        # For EigenAI (verifiable inference)

# Trading (without these, agent runs in read-only mode)
AGENT_PRIVATE_KEY=0x...
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
ALCHEMY_API_KEY=...

# Data sources (optional but recommended)
COINGECKO_API_KEY=...   # For technical indicators
GROK_API_KEY=...        # For X/Twitter sentiment

# Safety
DRY_RUN=true            # Set to block all trades
```

### LLM Provider Options

| Provider | Env Var | Model | Notes |
|----------|---------|-------|-------|
| **Anthropic** (default) | `ANTHROPIC_API_KEY` | Claude Sonnet 4.5 | Best overall performance |
| **OpenAI** | `OPENAI_API_KEY` | GPT-4o | Alternative option |
| **EigenAI** | `EIGENAI_API_KEY` or `EIGENAI_PRIVATE_KEY` | gpt-oss-120b-f16 | Verifiable AI inference |

#### EigenAI Authentication

EigenAI supports two authentication methods:

| Method | Env Var | API Endpoint | Use Case |
|--------|---------|--------------|----------|
| **API Key** (simpler) | `EIGENAI_API_KEY` | eigenai.eigencloud.xyz | Quick setup |
| **Wallet Signing** (verifiable) | `EIGENAI_PRIVATE_KEY` | determinal-api.eigenarcade.com | Cryptographic proof of inference |

If both are set, API key takes precedence.

#### EigenAI Two-Model Architecture

EigenAI uses a specialized **two-model architecture** for agentic workflows:

```
┌──────────────────────────────────────────────────────────────────┐
│                    EigenAI AGENTIC FLOW                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  MODEL 1: gpt-oss-120b-f16 (Tool Orchestration)             │ │
│  │                                                             │ │
│  │  • Executes tool calls iteratively                          │ │
│  │  • Gathers market data, prices, indicators, sentiment       │ │
│  │  • Up to 8 tool calls to build context                      │ │
│  │  • Optimized for function calling, NOT text generation      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  MODEL 2: qwen3-32b-128k-bf16 (Reasoning & Decision)        │ │
│  │                                                             │ │
│  │  • Receives ALL gathered context from tool calls            │ │
│  │  • Analyzes data and produces structured JSON decision      │ │
│  │  • Returns BUY/SELL/HOLD with detailed reasoning            │ │
│  │  • Signature captured for verifiable inference (Recall)     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Why two models?**

| Model | Strength | Limitation |
|-------|----------|------------|
| `gpt-oss-120b-f16` | Excellent at tool calling | Cannot produce text output or complex reasoning |
| `qwen3-32b-128k-bf16` | Strong reasoning, structured output | Used only for final decision |

This architecture ensures:
- ✅ **Efficient tool orchestration** - gpt-oss handles data gathering
- ✅ **Quality decisions** - qwen provides sophisticated market analysis  
- ✅ **Verifiable inference** - Only the final reasoning decision (from qwen) is signed and stored for Recall submission
- ✅ **No infinite loops** - Automatic handoff after 8 tool calls prevents stuck agents

#### Recall Integration (Badge Verification)

When using EigenAI, verified signatures can be submitted to [Recall](https://recall.network) for badge status:

```bash
# Add to .env for Recall integration
RECALL_API_URL=https://api.staging.competitions.recall.network
RECALL_API_KEY=your-agent-api-key
RECALL_COMPETITION_ID=your-competition-uuid
```

Signatures are automatically submitted every 15 minutes. See [docs/recall-integration.md](docs/recall-integration.md) for details.

## 📊 Supported Tokens

### DeFi Tokens
- **WETH** - Wrapped Ether
- **USDC** - USD Coin (native)
- **AERO** - Aerodrome Finance
- **cbETH** - Coinbase Wrapped Staked ETH
- **cbBTC** - Coinbase Wrapped BTC
- **VIRTUAL** - Virtual Protocol

### Community Tokens
- **BRETT** - Based Brett
- **DEGEN** - Farcaster community token
- **TOSHI** - Toshi the Cat

### Stablecoins
- **USDbC** - Bridged USDC
- **DAI** - Dai Stablecoin

## 🛠️ CLI Commands

```bash
# Check system health
pnpm cli health

# Run single analysis (always DRY_RUN)
pnpm cli analyze                           # Default: AERO/USDC
pnpm cli analyze --token BRETT --base WETH # Custom pair

# Start trading loop
pnpm cli start --dry-run    # Safe: simulated trades
pnpm cli start              # Real trades (5s warning)
```

## 🎮 Mastra Studio (Interactive Playground)

For interactive testing and ad-hoc tool calls, use Mastra Studio:

```bash
pnpm mastra:dev
```

Opens at **http://localhost:4111** with:

- **Chat Interface** - Talk to the agent directly, ask questions, request analysis
- **Tool Testing** - Call any tool manually (check prices, get quotes, execute trades)
- **API Endpoints** - REST API at `/api` for programmatic access

### Use Cases

| Use Case | How |
|----------|-----|
| Manual price check | Call `getTokenPrice` with token symbol |
| Get a swap quote | Call `getQuote` with token pair and amount |
| Execute a trade | Chat: "Buy $10 of AERO with USDC" |
| Debug indicators | Call `getIndicators` to see full technical analysis |

> **Note**: `pnpm mastra:dev` runs the Studio UI only. For autonomous trading, use `pnpm dev` or `pnpm cli start`.

## 🐳 Docker Deployment

Run the agent with included PostgreSQL (no external database needed):

```bash
# Copy and configure environment
cp config.env.example config.env
# Edit config.env with your API keys

# Start the stack
docker-compose up -d

# View logs
docker-compose logs -f agent

# Stop
docker-compose down
```

The stack includes:
- **PostgreSQL 16** - Persistent database with automatic migrations
- **Trading Agent** - Autonomous loop with health checks

Data persists in a Docker volume (`aerodrome-pgdata`). To reset:
```bash
docker-compose down -v  # Removes volumes
```

### Development with Docker

```bash
# Use dev override for source mounting
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## 🔧 Development

```bash
# Type check
pnpm type-check

# Lint
pnpm lint

# Format
pnpm format

# Run all checks
pnpm check-all

# Tests
pnpm test

# Database
pnpm db:generate    # Generate new migrations
pnpm db:migrate     # Apply migrations
pnpm db:studio      # Open Drizzle Studio
pnpm db:reset       # Drop all data and re-run migrations

# Mastra Studio
pnpm mastra:dev     # Interactive UI at localhost:4111
```

## 🔐 Security

- Private key is only used for signing, never logged
- All trades go through Aerodrome's audited Router contract
- Slippage protection on all swaps
- DRY_RUN mode to prevent accidental trades
- Database stores reasoning for audit trail

## 📄 License

[MIT](LICENSE)

---

Built with [Mastra](https://mastra.ai) on Base chain. Supports Anthropic, OpenAI, and EigenAI LLM providers.
