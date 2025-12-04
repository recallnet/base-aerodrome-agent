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
| `getQuote`            | Swap quotes from Aerodrome    | Input/output amounts, route |
| `getPoolMetrics`      | Pool reserves and config      | Raw reserves, stable flag   |
| `getTokenPrice`       | Token prices from DexScreener | Price, 24h change, volume   |
| `getWalletBalance`    | Current wallet balances       | ETH and token amounts       |
| `getTwitterSentiment` | X/Twitter observations        | Themes, sentiment velocity  |
| `executeSwap`         | Execute trades                | Transaction hash, status    |

### Database (Persistence)

| Table                 | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `trading_diary`       | Every decision with reasoning (like diary.jsonl) |
| `swap_transactions`   | Executed swaps with on-chain data                |
| `portfolio_snapshots` | Balance history for performance tracking         |
| `price_history`       | Cached prices for retrospective analysis         |

## 📁 Project Structure

```
src/
├── agents/
│   └── trading.agent.ts    # Single autonomous agent with system prompt
├── tools/
│   ├── aerodrome/          # DEX tools (quote, pool, swap)
│   ├── market/             # Price, balance, and indicators tools
│   └── sentiment/          # X/Twitter sentiment tool
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
# Required
DATABASE_URL=postgresql://user:pass@host:5432/dbname
ANTHROPIC_API_KEY=sk-ant-...

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
```

## 🔐 Security

- Private key is only used for signing, never logged
- All trades go through Aerodrome's audited Router contract
- Slippage protection on all swaps
- DRY_RUN mode to prevent accidental trades
- Database stores reasoning for audit trail

## 📄 License

MIT

---

Built with [Mastra](https://mastra.ai) and Claude Sonnet 4.5 on Base chain.
