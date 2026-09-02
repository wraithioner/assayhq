# Robinhood Chain — agent measurement

This repository set out to build a public scoreboard for autonomous trading agents on
**Robinhood Chain** (Arbitrum Orbit L2, chain ID **4663**), benchmarked on tokenized equities
("Stock Tokens"). Before publishing any performance number, we measured whether there was a
population to score.

**There is not.** Measured 2 September 2026 at head block **52,527,642**, on a chain that
launched 1 July 2026:

| | |
|---|---|
| ERC-8004 agent registrations, enumerated exactly | **61** (45 unique owners) |
| …that have moved a Stock Token after their own registration block | **3** |
| …whose trades can be matched to a priced execution — **benchmarkable** | **1** |
| Stock Token movements made by that one address | **4** |
| Sustained automated addresses trading Stock Tokens that never registered | **~51** |

Four movements cannot support a Sharpe ratio, an information ratio, or a drawdown series. A
leaderboard built on this would be publishing noise.

Separately, automated Stock Token trading on the chain is large — roughly **11.5M movements
per day** — and roughly **51** addresses trade continuously across independent sampled windows.
But their observable behaviour is bursty rather than scheduled (median inter-event coefficient
of variation **2.14**; 2 of 38 measurable addresses look like a scheduled job), they run
round-the-clock, and they are **51 distinct singleton bytecodes** rather than a fleet from one
agent framework. That profile describes market-making and arbitrage infrastructure, not a
population of strategy agents making periodic allocation decisions. Bytecode cannot prove
intent, and this does not settle what those addresses are — but it does not support calling
them AI trading agents.

**One correction, added after the fact.** That verdict is about *agents* and *tokenized
equities*, and it holds. It is not a verdict on the chain. Robinhood Chain earns
**$157.9M in protocol fees per 30 days — the #4 chain in crypto** — on $19.2B of DEX volume,
almost all of it memecoin launchpads and DEX trading. Stock Tokens are roughly 2% of on-chain
token value. See [`docs/CHAIN_SCALE.md`](docs/CHAIN_SCALE.md), which also explains why that
activity looks like farming into the end of a gas subsidy rather than durable demand.

**The measurement write-ups are the substance of this repository:**

- **[`docs/MARKET_SIZE.md`](docs/MARKET_SIZE.md)** — *Are there benchmarkable AI trading agents
  on Robinhood Chain?* Method, sampling limits, the flow numbers, the cadence and bytecode
  findings, and re-run instructions.
- **[`docs/BACKFILL.md`](docs/BACKFILL.md)** — the ERC-8004 registry diagnostic: the full
  61 → 45 → 3 → 1 funnel, why the two exclusions are real rather than artefacts of a strict
  filter, and the registry addresses.
- **[`docs/AGENT_VENUE.md`](docs/AGENT_VENUE.md)** — where Robinhood's agents actually execute,
  verified against the newsroom, support docs, chain developer docs and SEC filings. Agentic
  Trading shipped 27 May 2026 and by 29 July held **~100,000 accounts and over $100M in AUC**,
  entirely inside custodial US brokerage accounts. Of the 57 documented Trading MCP tools
  **none transfers, bridges, stakes or withdraws**, so there is no path from an agent to any
  chain. Stock Tokens are Regulation S instruments that may not be delivered to US persons,
  while Agentic Trading is offered only to US customers: **the two populations are legally
  disjoint.**
- **[`docs/CHAIN_SCALE.md`](docs/CHAIN_SCALE.md)** — what the chain is actually used for, and
  the correction to this repository's own framing. **$157.9M of protocol fees per 30 days across
  121 protocols, #4 chain in crypto**, of which launchpads alone are $46.9M. The largest token
  by holders after USDG is a memecoin, CASHCAT, worth 21× the largest tokenized equity. Includes
  the falsifiable prediction for the 29 September gas-subsidy expiry.
- **[`docs/HOLDER_BASE.md`](docs/HOLDER_BASE.md)** — who actually holds Stock Tokens. Full
  enumeration of all **193** indexed tokens and **919,694** holder positions; nothing sampled.
  **237,903** distinct addresses hold a non-zero balance, but only **1,228** hold more than
  $1,000, **157** more than $10,000 and **25** more than $100,000, at a median customer balance
  of **$0.50**. **$40.8M of the $70.9M on chain sits in venue infrastructure**, not customer
  wallets. The publicly cited figure of **328,000** holders does not reconcile; on a
  like-for-like date basis the cohort curve puts roughly **43,000** addresses at that
  measurement date.

## Status

**The research phase is complete: five findings published, no product built, building
paused.** The measurement stack itself is built and tested — ERC-8056 adapter, raw-event
indexer, metrics engine and static export, 94 tests across four packages — but **the
scoreboard was never published, because there is no agent population to score.** The committed
site snapshot is empty and no agent rows are seeded. Robinhood's own agent population is
large; it simply executes in the brokerage, where it emits no logs, and no product routes it
onchain ([`AGENT_VENUE.md`](docs/AGENT_VENUE.md)).

Building is paused. Every number above was produced while Robinhood covered gas; the 90-day
fee waiver ends around **29 September 2026**, and no measurement of this chain unsubsidised
exists yet. The next step is that comparison, which is a single command
([below](#re-running-the-measurements)), not more code.

No gate was relaxed to manufacture a population: scoring still begins at an agent's
registration block and is never backfilled, behavioural heuristics remain display-only, and
scoring is still restricted to the 35 feed-covered tokens.

## Why measurement was the question

The published literature on LLM trading agents has a measurement problem rather than a
performance problem. In a survey of 77 studies, 19 met a minimum bar of producing actions in a
closed loop; of those, roughly one modelled transaction costs and one documented survivorship
handling, and none reached full reproducibility.

On-chain execution can supply what is missing, because four things become facts rather than
claims: **identity** (you know which address acted, and it cannot be swapped afterwards),
**costs** (every fill has a real execution price and a real gas cost), **survivorship** (a dead
agent is still in the data), and **point-in-time** valuation (a position can be valued using
only information available at that block). An address is benchmarkable only if all four hold —
which is the bar the funnel above applies.

## ERC-8056: `@assayhq/erc8056`

The corporate-action mechanics were the part of the chain expected to be dangerous. They are
not. The adapter written for this project is released standalone on npm:

**[`@assayhq/erc8056`](https://www.npmjs.com/package/@assayhq/erc8056)** — raw ↔ underlying-share
conversion, a point-in-time multiplier history, and multiplier-independent valuation. Zero
runtime dependencies, MIT, with a matching Solidity library so on-chain and off-chain
accounting agree to the wei.

```bash
npm install @assayhq/erc8056
```

Measured against every `UIMultiplierUpdated` event ever emitted on the chain (17 events across
10 tokens, committed as a test fixture):

- **A 1% reinvested dividend costs a constant-product pool ≈ 0.124 bps of pool value** — about
  one part in 80,000, two orders of magnitude below a single Uniswap fee tier. The largest
  distribution ever emitted on this chain (CCL, +2.15%) costs 0.571 bps.
- **A compensated split — 10:1, 4:1, any ratio — costs exactly zero.** Raw balances never
  rebase and the feed is total-return, so neither the pool nor fair value moves.
- The `r = 10` figure quoted for an *uncompensated* split is a bound on multiplier/feed
  desynchronisation, not an expected loss. It has never happened.

The real hazard of ERC-8056 is share accounting — reading `balanceOf()` as a share count, or
applying the multiplier twice — which is off by whole multiples rather than fractions of a
basis point. See [`packages/erc8056/README.md`](packages/erc8056/README.md) for the arithmetic
and the full on-chain history.

## Chain facts

Established in [`docs/RECON.md`](docs/RECON.md) against primary sources, with a Corrections
section listing where the original brief was wrong:

- Chain ID **4663**; native gas **ETH**; public RPC `https://rpc.mainnet.chain.robinhood.com`;
  Blockscout explorer with a full REST API.
- **194** stock/ETF tokens, all 18-decimal ERC-20 BeaconProxies over one shared implementation.
- Stock tokens implement ERC-8056. The deployed contracts emit **`TransferWithScaledUI`**
  (topic `0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802`), **not** the
  EIP-8056 draft's `TransferWithUIAmount`, whose topic never appears on chain.
- Chainlink feeds are **total-return, multiplier-adjusted, 8-decimal** — the multiplier must not
  be re-applied. **Only 35 of 194 tokens have a feed.** Coverage excluded no agent in the funnel
  above; it was not the binding constraint. Measured across the whole holder base, the 158
  feed-less tokens hold **$21.0M, 23.7% of on-chain Stock Token value, with no independent
  oracle** ([`HOLDER_BASE.md`](docs/HOLDER_BASE.md) §5).
- **194** tokens exist, but **193** are indexed as tokens by Blockscout; BND returns 404 and is
  excluded from the holder census.
- The **ERC-8004 identity registry is live** at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
  and is not referenced anywhere in Robinhood's developer documentation.
- **90-day gas waiver active** (launch 2026-07-01 → ≈ 2026-09-29).

Also here: [`docs/DECISIONS.md`](docs/DECISIONS.md) (non-obvious calls and why),
[`docs/data/`](docs/data) (primary-source snapshots with sha256 provenance and normalized CSVs).

## What is built

```
packages/erc8056   # raw <-> underlying-share adapter (TS + Solidity), multiplier history
packages/indexer   # Transfer, TransferWithScaledUI, UIMultiplierUpdated, DEX swaps -> SQLite
packages/metrics   # NAV, return/alpha/IR/Sharpe/maxDD net of gas+slippage; survivorship + PIT
apps/web           # static leaderboard + per-agent "verify this yourself" recompute panel
scripts/recon      # Phase 0 primary-source verification (verify.sh, keccak.py)
scripts/snapshot   # deterministic pre/post gas-subsidy snapshot + --diff
scripts/holders    # full Stock Token holder enumeration, pricing, classification (HOLDER_BASE)
```

The indexer stores raw events only and derives nothing; it includes point-in-time ERC-8004
wallet bindings, canonical Stock Token filtering, Uniswap attribution, Chainlink proxy
snapshots, an unattributed-flow detector, and a tested reorg/resume loop. Metrics reads that
index read-only. Stack: TypeScript, viem, SQLite, Drizzle, Next.js; versions pinned.

Only `packages/erc8056` is published. The other three are workspace-internal and marked
private.

```bash
corepack pnpm install
corepack pnpm -r test        # 94 tests
corepack pnpm -r typecheck
```

## Re-running the measurements

The subsidy comparison — the one open variable — against the committed baseline:

```bash
# baseline: docs/data/snapshots/2026-09-02-pre-subsidy-end.json (head block 52,527,642)
python3 scripts/snapshot/subsidy_snapshot.py --out docs/data/snapshots/2026-09-30-post-subsidy-end.json

python3 scripts/snapshot/subsidy_snapshot.py --diff \
  docs/data/snapshots/2026-09-02-pre-subsidy-end.json \
  docs/data/snapshots/2026-09-30-post-subsidy-end.json
```

Sampling constants are fixed in the script; changing them between runs invalidates the
comparison.

The recon facts, read-only:

```bash
bash scripts/recon/verify.sh     # RPC / Blockscout / API checks
python3 scripts/recon/keccak.py  # event topic0 hashes (self-tested)
```

The registry funnel can be re-derived directly from `eth_getLogs` — the exact calls are in
[`docs/MARKET_SIZE.md` §7](docs/MARKET_SIZE.md#7-reproducing-this).

The holder census, re-runnable end to end (~40 minutes; see
[`scripts/holders/README.md`](scripts/holders/README.md) for the two rate-limit traps that
will otherwise silently truncate the result):

```bash
cd scripts/holders
cp ../../docs/data/stock-tokens.csv ../../docs/data/chainlink-feeds.csv .
python3 fetch_meta.py     # exact per-token holder counts
python3 price.py          # 35 Chainlink feeds at the head block
python3 enum_v3.py        # every holder of every token, resumable
python3 build.py          # -> addr_values.tsv, coverage + missed-value bound
python3 classify.py && python3 identify.py && python3 infra.py
python3 final_analysis.py # distribution, histogram, concentration
```

Given an index, a score recomputes from SQLite alone:

```bash
corepack pnpm --filter @assayhq/metrics recompute --db data.sqlite --agent <erc8004-agent-id>
```

The JSON result includes the evaluation block and the exact command needed to reproduce it. The
database is opened read-only.

Exporting the static site:

```bash
INDEX_DB=/absolute/path/index.sqlite corepack pnpm --filter @assayhq/web export:data
corepack pnpm --filter @assayhq/web build
```

The exporter opens the index read-only. The generated site is written to `apps/web/out/` and
makes no browser-side RPC calls. Unscoreable and inactive registrants stay visible so the
presentation does not reintroduce survivorship bias.

## Non-goals

Not built and not scaffolded: custody, vaults, copy-trading, wallet connect, a token, anything
requiring KYC or handling PII, and write transactions of any kind. Everything here is read-only.

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE).

`packages/erc8056` is licensed separately under **MIT** (see
[`packages/erc8056/LICENSE`](packages/erc8056/LICENSE)), so it can be vendored without the
Apache-2.0 attribution requirements.
