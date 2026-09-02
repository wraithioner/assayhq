# Robinhood Chain Agent Scoreboard

A read-only, public scoreboard that scores autonomous trading agents on **Robinhood Chain**
(Arbitrum Orbit L2, chain ID **4663**), benchmarked on tokenized equities ("Stock Tokens").

The thesis is a measurement one: the literature on LLM trading agents mostly fails to model
transaction costs and survivorship. On-chain execution fixes this for free — every fill is signed
and timestamped, and dead agents can't be deleted from the sample. This project indexes that truth
and publishes metrics that are **net of costs, survivorship-safe, point-in-time, and recomputable
by a third party**.

## Status: Phase 1 — indexer correctness pass

Phase 0 established ground truth against primary sources. Phase 1 is approved and underway:
the ERC-8056 adapter is complete, and the raw-event indexer now has point-in-time ERC-8004 wallet
bindings, canonical Stock Token filtering, Uniswap attribution, Chainlink proxy snapshots, and a
tested reorg/resume loop. Metrics and the static web scoreboard are next. Start here:

- **[`docs/RECON.md`](docs/RECON.md)** — the recon deliverable: chain params, token & feed
  addresses, exact ERC-8056 interface + event topic hashes, ERC-8004 registry, DEX venues, the gas
  subsidy window, an agent-identification design, a Corrections section, and OPEN items.
- **[`docs/DECISIONS.md`](docs/DECISIONS.md)** — non-obvious calls and why.
- **[`docs/data/`](docs/data)** — primary-source snapshots (sha256 provenance) + normalized CSVs.
- **[`scripts/recon/`](scripts/recon)** — read-only reproduction (`verify.sh`) + self-tested
  keccak (`keccak.py`).

### Headline facts (all verified — see RECON.md for sources)

- Chain ID **4663**; native gas **ETH**; public RPC `https://rpc.mainnet.chain.robinhood.com`;
  Blockscout explorer with a full REST API.
- **194** stock/ETF tokens, all 18-decimal ERC-20 **BeaconProxies over one shared implementation**.
- Stock tokens implement **ERC-8056**; index **`TransferWithScaledUI`**
  (topic `0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802`) — it carries both raw
  and underlying-share values.
- Chainlink feeds are **total-return, multiplier-adjusted, 8-decimal** — **do not re-apply the
  multiplier**. **Only 35 of 194 tokens have a feed** (a real scoring-coverage gap).
- **ERC-8004 agent registry is live** (`IdentityRegistry 0x8004A169…`) — the anchor for the v1
  agent universe.
- **90-day gas waiver active** (launch 2026-07-01 → ≈ 2026-09-29) — a cost-regime change the
  metrics engine must model.

## Reproduce the recon

```bash
bash scripts/recon/verify.sh     # read-only RPC/Blockscout/API checks
python3 scripts/recon/keccak.py  # event topic0 hashes (self-tested)
```

## Non-goals (not built, not scaffolded)

No custody, vaults, copy-trading, wallet connect, token, KYC/PII, or write transactions of any
kind. Phase 1 is an indexer + metrics engine + static leaderboard only.

## Phase 1 layout

```
packages/erc8056   # raw <-> underlying-share adapter (TS + Solidity), multiplier history
packages/indexer   # backfill/follow Transfer, TransferWithScaledUI, UIMultiplierUpdated, DEX swaps
packages/metrics   # NAV, return/alpha/IR/Sharpe/maxDD net of gas+slippage; survivorship + point-in-time
apps/web           # sortable static leaderboard + per-agent "verify this yourself" recompute panel
```

Stack: TypeScript, viem, SQLite, Drizzle, Next.js. Versions are pinned.
