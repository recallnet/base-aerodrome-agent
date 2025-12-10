# AI Trading Agent for Aerodrome DEX | Autonomous DeFi Trading on Base

An autonomous spot trading agent for [Aerodrome DEX](https://aerodrome.finance/) on Base chain, built with the [Mastra](https://mastra.ai) AI framework. Supports **verifiable AI inference** via [EigenAI](https://eigenai.xyz).

## 🎯 What This Does

This agent autonomously trades tokens on Aerodrome DEX by:

1. **Gathering data** - Token prices, pool liquidity, technical indicators, X/Twitter sentiment
2. **Reasoning about it** - The AI agent interprets what the data means
3. **Making decisions** - BUY, SELL, or HOLD based on its analysis
4. **Executing trades** - Swaps tokens on Aerodrome when confident
5. **Learning from outcomes** - Logs decisions and tracks retrospective performance

**Optional**: Use **EigenAI** for cryptographically signed AI responses, enabling verifiable proof that your agent's decisions came from a specific AI model.

## 🚀 Quick Start

### One-Command Setup (Recommended)

```bash
# Clone and install
git clone <repo>
cd aerodrome-eigen-agent
npm install

# Run setup (starts PostgreSQL, creates .env, runs migrations)
npm run setup

# Check configuration
npm run cli health

# Run a single analysis (safe - no trades)
npm run cli analyze
```

### Manual Setup

```bash
# Install dependencies
npm install

# Start PostgreSQL (requires Docker)
docker-compose up -d

# Configure environment
cp .env.example .env
# Edit .env with your values

# Run database migrations
npm run db:migrate

# Verify setup
npm run cli health
```

### Choose Your AI Provider

**Option A: Anthropic Claude (Default)**
```bash
# In .env:
ANTHROPIC_API_KEY=sk-ant-...
```

**Option B: EigenAI (Verifiable Inference)**
```bash
# In .env:
EIGENAI_ENABLED=true
EIGENAI_GRANT_PRIVATE_KEY=0x...  # Wallet with active EigenAI grant
```

See [EigenAI Configuration](#eigenai-verifiable-ai) below for details.

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
├── loop/
│   └── trading-loop.ts     # Simple loop calling agent.generate()
├── database/
│   ├── schema/trading/     # Drizzle schema for trading data
│   └── repositories/       # Data access methods
├── config/
│   ├── tokens.ts           # Token addresses and metadata
│   └── contracts.ts        # Aerodrome contract ABIs
├── execution/
│   └── wallet.ts           # Wallet and signing utilities (Alchemy SDK)
├── cli/
│   └── index.ts            # CLI commands (health, analyze, start)
└── index.ts                # Application entry point
```

## 🔧 Configuration

Create a `.env` file:

```bash
# Required (one of these)
DATABASE_URL=postgresql://agent:agent_dev_password@localhost:5432/aerodrome_agent
ANTHROPIC_API_KEY=sk-ant-...  # OR use EigenAI below

# EigenAI (alternative to Anthropic - verifiable inference)
EIGENAI_ENABLED=true
EIGENAI_GRANT_PRIVATE_KEY=0x...  # Wallet with active EigenAI grant

# Trading (without these, agent runs in read-only mode)
AGENT_PRIVATE_KEY=0x...
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# Data sources (optional but recommended)
# CoinGecko: use ONE of these (Pro takes precedence if both set)
COINGECKO_PRO_API_KEY=...   # Pro tier (pro-api.coingecko.com)
COINGECKO_DEMO_API_KEY=...  # Demo tier (api.coingecko.com)
GROK_API_KEY=...        # For X/Twitter sentiment

# Observability (optional)
LANGFUSE_SECRET_KEY=... # For agent tracing and monitoring
LANGFUSE_PUBLIC_KEY=... # Get keys at https://cloud.langfuse.com
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# Safety
DRY_RUN=true            # Set to block all trades
```

## 🔐 EigenAI (Verifiable AI)

EigenAI provides **cryptographically signed AI responses** via the [dTERMinal API](https://eigenarcade.com). Each response includes an ECDSA signature proving the output came from a specific AI model.

### Why Use EigenAI?

- **Verifiable inference**: Prove your agent's decisions came from AI
- **Competition compliance**: Required for [Recall](https://recall.xyz) competitions
- **Audit trail**: Store cryptographic proofs of AI-generated decisions

### Setup

1. **Get an EigenAI Grant**
   - Visit [eigenai.xyz](https://eigenai.xyz) or contact the EigenAI team
   - Create a wallet specifically for EigenAI grants (separate from your trading wallet)
   - Fund the wallet with an active grant (allocation of inference tokens)

2. **Configure Environment**
   ```bash
   # .env
   EIGENAI_ENABLED=true
   EIGENAI_GRANT_PRIVATE_KEY=0x...  # Grant wallet private key

   # Optional overrides (defaults shown)
   EIGENAI_API_URL=https://determinal-api.eigenarcade.com
   EIGENAI_MODEL_ID=gpt-oss-120b-f16
   ```

3. **Verify Setup**
   ```bash
   npm run cli health
   # Should show: EigenAI: ✅ Enabled
   ```

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. Agent calls EigenAI API (with grant authentication)     │
│  2. EigenAI returns response + ECDSA signature              │
│  3. Agent verifies signature locally                        │
│  4. Signature stored in database for audit trail            │
│  5. Optional: Submit to Recall API for competition tracking │
└─────────────────────────────────────────────────────────────┘
```

### Signature Verification

The agent automatically:
- Captures request/response pairs from each AI call
- Verifies signatures using message reconstruction (`ChainID + ModelID + Prompt + Output`)
- Recovers the signer address and validates against expected signer
- Stores verification results in the database

See `src/eigenai/` for implementation details.

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

## 📊 Observability

Optional [Langfuse](https://langfuse.com) integration provides:
- Real-time tracing of agent decisions and tool calls
- Execution monitoring and debugging
- Performance analytics across iterations
- Token usage tracking

When Langfuse credentials are provided, traces automatically appear in your dashboard. Works in both development (realtime) and production (batched) modes.

## 🚀 Deployment

This agent is designed to run as a **24/7 background process**. Choose your deployment based on your needs:

### Local Development

```bash
npm run setup              # One-command setup with Docker PostgreSQL
npm run cli start --dry-run  # Start trading loop (simulated)
```

### Production Deployment

| Platform | Cost | Best For |
|----------|------|----------|
| **[Railway](https://railway.app)** | $5/mo | Recommended - includes PostgreSQL |
| **[Render](https://render.com)** | Free-$7/mo | Budget option (free DB expires in 90 days) |
| **[Fly.io](https://fly.io)** | $0-10/mo | Global edge deployment |
| **Vercel + Cron** | $0-20/mo | Scheduled iterations (not 24/7) |

### Railway (Recommended)

```bash
# Install CLI
npm i -g @railway/cli

# Deploy
railway login
railway init
railway add --database postgres
railway up

# Configure environment variables in Railway dashboard
# Run migrations
railway run npm run db:migrate
```

### Docker Deployment

```bash
# Build image
docker build -t aerodrome-agent .

# Run with external PostgreSQL
docker run -d \
  -e DATABASE_URL=postgresql://... \
  -e ANTHROPIC_API_KEY=... \
  aerodrome-agent
```

### Database Options

| Provider | Free Tier | Notes |
|----------|-----------|-------|
| **Railway** | None | $5/mo, included with app deployment |
| **Neon** | 512 MB | Serverless PostgreSQL, auto-scaling |
| **Supabase** | 500 MB | Includes auth/storage/realtime |
| **Render** | 90 days | Free expires, then $7/mo |

See [docs/deployment-options.md](docs/deployment-options.md) for comprehensive deployment guides.

## 📄 License

[MIT](LICENSE)

---

Built with [Mastra](https://mastra.ai) on Base chain. Supports [Anthropic Claude](https://anthropic.com) and [EigenAI](https://eigenai.xyz) for verifiable inference.
