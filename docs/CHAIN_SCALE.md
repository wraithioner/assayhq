# What Robinhood Chain is actually used for

**A correction to this repository's own framing.** Measured 2 September 2026.

Four documents here — [`MARKET_SIZE.md`](./MARKET_SIZE.md), [`BACKFILL.md`](./BACKFILL.md),
[`AGENT_VENUE.md`](./AGENT_VENUE.md) and [`HOLDER_BASE.md`](./HOLDER_BASE.md) — measured
ERC-8004 agents and tokenized equities on chain 4663, found almost nothing, and I framed that
as a verdict on the chain. **The measurements were right. The framing was wrong.** Stock Tokens
are roughly 2% of on-chain token value. The chain itself is one of the busiest in crypto.

---

## The numbers

| | |
|---|---:|
| Protocol fees, 30d, across 121 protocols | **$157,875,275** |
| Rank among all chains by 30d protocol fees | **#4** |
| DEX volume, 30d | **$19,160,293,601** |
| Fee / volume, 30d | **0.671%** |
| Fee / volume, 24h | **1.017%** |

For scale, 30d protocol fees by chain: off-chain $764.6M (Tether, Circle, Polymarket) ·
Solana $366.1M · Ethereum $311.1M · **Robinhood $157.9M** · Hyperliquid $150.2M · BSC $80.3M ·
Base $52.7M · Canton $49.0M. DEX volume: Solana $63.6B · Ethereum $34.6B · Base $23.8B ·
**Robinhood $19.2B** · Hyperliquid $9.7B.

## What generates it

| Category | 30d fees |
|---|---:|
| DEXs | $75,119,036 |
| **Launchpads** | **$46,915,690** |
| Telegram bots | $15,244,649 |
| The chain itself | $10,304,589 |
| NFT marketplace | $2,226,303 |
| Everything else | $8,065,758 |

Largest single earners: Uniswap V4 $44.7M · Pons V2 (launchpad) $26.9M · Uniswap V3 $23.2M ·
GMGN (memecoin Telegram bot) $14.7M · Pons V1 $8.3M · NOXA Fun $4.2M · StonkBrokers $2.5M.

A 0.67–1.02% fee-to-volume ratio is bonding-curve and memecoin pricing, not blue-chip DEX
pricing. Uniswap V3's normal tiers run 0.05–0.30%.

## What people actually hold

Largest tokens by circulating market cap (Blockscout, same date):

| Token | Market cap | Holders |
|---|---:|---:|
| LINK | $8.32B | 26 (bridged, not traded) |
| CBBTC | $7.68B | 4,068 |
| USDE | $4.24B | 5,300 |
| **USDG** | **$3.23B** | **193,895** |
| PENGU | $520M | 896 |
| VIRTUAL | $445M | 14,160 |
| **PONS** | **$292M** | **63,261** |
| **CASHCAT** | **$267M** | **104,221** |
| … | | |
| **NVDA** (largest Stock Token) | **$12.8M** | 91,624 |

USDG is the chain's base money. **CASHCAT — a memecoin — is worth 21× the largest tokenized
equity and has more holders.** All 194 Stock Tokens together are $70.9M
([`HOLDER_BASE.md`](./HOLDER_BASE.md)), of which $40.8M sits in venue contracts.

## Why this still is not a green light

Every marker points at incentive farming rather than durable demand:

- **Daily fees went from $2.75M (13 Aug) to $18.75M (2 Sep)** — 6.8× in ten days, still climbing.
- **Pons V2 earned 81% of its all-time fees in the last seven days.**
- **No token or airdrop has been announced.** Robinhood has confirmed no points programme and
  no native token; third-party "farming playbooks" for the chain are nonetheless widespread.
- **Free gas via Robinhood Wallet is 90 days from 2026-07-01 — it ends ~29 Sept–1 Oct 2026.**
- Our own holder census: **63.6% of Stock Token holders made their first acquisition in the
  final two weeks, at a median balance of $0.50.**

People paying roughly 1% in trading fees, at accelerating volume, in the closing weeks of a gas
subsidy, on a chain with no announced token, is the textbook shape of speculative farming. It
may well survive the subsidy. **It has not been tested once**, and the test costs one command.

## The falsifiable prediction

The baseline is already committed at [`data/snapshots/2026-09-02-pre-subsidy-end.json`](./data/snapshots).

> **If fees fall more than 70% within two weeks of the subsidy ending, the activity was
> farming.** If they hold above roughly half of the pre-expiry run-rate, this is a real venue
> and everything in this repository should be re-read with that in mind.

```bash
python3 scripts/snapshot/subsidy_snapshot.py --out docs/data/snapshots/2026-09-30-post-subsidy-end.json
python3 scripts/snapshot/subsidy_snapshot.py --diff \
  docs/data/snapshots/2026-09-02-pre-subsidy-end.json \
  docs/data/snapshots/2026-09-30-post-subsidy-end.json
```

The snapshot now also carries the holder base, so the diff answers "did the *holders* leave?"
directly rather than by inference:

- **`holderPositions`** — exact, the summed per-token holder count. If the base was rented,
  this is what collapses.
- **`customerValueUsd`** and **`venueInfraValueUsd`** — priced with Chainlink and split by the
  committed venue set, so liquidity leaving pools is not mistaken for customers leaving.
- **`indexAddressesOver`** — how many index addresses hold more than $100 / $1k / $10k / $100k.

The value figures are a **fixed-depth index** (top 200 holders per token), not a population
total: two runs at the same depth are exactly comparable, which is what a diff needs. Measured
against the complete enumeration behind [`HOLDER_BASE.md`](./HOLDER_BASE.md), depth 200 holds
**95.11% of priced value and 88.55% of customer value — but only 28.6% of addresses over $100**,
because a holder with $500 spread across five tokens sits deep in all five lists. Address counts
are therefore reported for the index only. `--full-holders` enumerates everything exactly and
takes about two hours.

The 2 September baseline was **backfilled** with these metrics from the same-day complete
census, so the comparison is valid despite the metrics being added after the baseline was taken.

## Sources

All pulled 2026-09-02 and committed under [`data/chain/`](./data/chain):

- `rh_chain_fees.json` — per-protocol 30d fees on chain 4663, DefiLlama `/overview/fees`
- `rh_fees.json` — daily fee series for the chain
- `rh_dex.json` — daily DEX volume series
- `toks.json` — Blockscout token list by circulating market cap

Chain-level comparisons were computed from the same DefiLlama fee dataset (2,649 protocols) by
summing each protocol's `breakdown30d` per chain.

**What this does not change.** The agent findings stand: 61 ERC-8004 registrations, one
benchmarkable address, and no path from Robinhood's ~100k custodial agentic accounts to any
chain. The holder census stands: 237,903 addresses, 1,228 above $1,000, median $0.50. Those
were correct measurements of what they measured. This document corrects only the inference
drawn from them about the chain as a whole.
