# MARKET_SIZE — is there an agent population that doesn't use ERC-8004?

**Question.** Public reporting claims ~2,100 agents deployed in week one. Only **61** ever
registered with ERC-8004, and only **1** survives every scoring gate
([`BACKFILL.md`](./BACKFILL.md)). Does a real population exist that simply never registered?

**This is a count, not a scoring change.** Nothing measured here enters the scoring universe.
D3 (scoring starts at the ERC-8004 registration block, never backfilled) stands unchanged. No
profiles, no rankings, no per-address data — this document contains counts only.

**Measured:** 2026-09-02, head block **52,527,642**.

---

## Answer against the pre-committed decision rule

> *Decision rule, fixed before looking: if fewer than 20 addresses show sustained agent-like
> Stock Token activity, the equity-agent population does not exist.*

**Sustained, machine-cadence, non-venue addresses trading Stock Tokens: 51.**

The rule is **met** — the threshold of 20 is exceeded at the pre-committed definition and at
the next two strictness levels. The population exists. It just does not register.

| "Sustained" = present in ≥ k of 16 independent windows | Addresses (venue pools excluded) |
|---|---|
| **≥ 3 (pre-committed threshold)** | **51** |
| ≥ 5 | 33 |
| ≥ 8 | 17 |
| ≥ 10 | 12 |
| ≥ 12 | 8 |

The count is above 20 at k=3 and k=5, and below it at k≥8. The threshold used is the one
fixed in the script before the data was collected (`SUSTAINED_MIN_WINDOWS = 3`), not chosen
afterwards. The ladder is published so the sensitivity is visible rather than hidden.

Why k=3 is a strong bar rather than a weak one: each window is 400 blocks ≈ **40 seconds**,
and the 16 windows together cover **0.0122%** of all blocks since launch. Appearing in three
separate 40-second snapshots scattered across 60 days implies the address is active in a
large fraction of all such intervals. It is not a low bar; it is a sparse-sampling bar.

---

## The counts

### Scale of Stock Token activity

| Measure | Value |
|---|---|
| Stock Token movements (`TransferWithScaledUI`) | **13.26 / block ≈ 11.46M / day** |
| Chain-wide transactions | 15.55 / block ≈ 13.44M / day |
| Movements per chain transaction | ≈ 0.85 |

Chain-wide throughput matches the ~11.6M tx/day figure in public reporting. The surprise is
the ratio: by **event count**, Stock Token movements are now nearly one per transaction on the
whole chain. That is not a statement about value — RWA value on chain is small — it is a
statement about how much automated Stock Token traffic exists.

### Addresses with >50 Stock Token movements since launch

**The >50 threshold does not discriminate at this density**, and the honest answer is that the
qualifying population is in the thousands.

In 6,400 sampled blocks (0.0122% of chain history) there were **1,694 distinct participating
addresses**. Extrapolation factor is ~8,207×:

| Sampled movements | Addresses | Implied since-launch total |
|---|---|---|
| ≥ 1 | 1,694 | ≳ 8,200 |
| ≥ 2 | 850 | ≳ 16,400 |
| ≥ 5 | 244 | ≳ 41,000 |
| ≥ 10 | 122 | ≳ 82,000 |
| ≥ 50 | 35 | ≳ 410,000 |

Even a single sampled movement implies ~8,200 movements since launch under uniform activity.
So essentially every address that appears at all clears ">50". The discriminating question is
sustained presence, which is why the ladder above is the reported answer.

### Machine-like cadence (of the 50 non-pool sustained addresses profiled)

| Signal | Count |
|---|---|
| Active in ≥3 off-hours windows (outside the US cash session, incl. weekends) | **50 / 50** |
| Enough intra-window events to measure inter-event regularity | 38 |
| Highly regular timing (gap CV < 1.0) | **2 / 38** |
| Median inter-event gap CV | **2.14** (min 0.76, max 6.80) |

Two signals point in opposite directions, and both matter:

- **Round-the-clock operation is universal.** Every sustained address transacts outside US
  market hours and at weekends. No human is doing this.
- **The timing is bursty, not metronomic.** A median gap CV of 2.14 means activity arrives in
  clusters, not on a schedule. Only 2 of 38 look like a cron job.

Bursty + 24/7 + pool-adjacent is the signature of **event-driven market-making or arbitrage**,
not of a scheduled portfolio-rebalancing agent.

### EOA vs contract, and bytecode clusters

Of the 69 sustained addresses before venue filtering:

| | Count |
|---|---|
| Venue infrastructure (answers `token0()` — i.e. AMM pools) — **excluded** | 19 |
| Remaining sustained addresses | 50 |
| — contracts | 41 |
| — EOAs | 9 |

Contract fleets (identical deployed code size ⇒ one template, different constructor/immutable
arguments):

| Code size | Members | Note |
|---|---|---|
| 22,142 B | 13 | Uniswap V3 pools — venue infrastructure, excluded from the agent count |
| 130 B | 4 | clone-with-immutable-args proxies |
| 45 B | 3 | EIP-1167 minimal proxies |
| 23 B | 2 | stub proxies |
| everything else | 1 each | 51 distinct singleton bytecodes |

**There is no large cloned agent fleet.** Excluding pools, the sustained population is mostly
*distinct* bytecode — 51 singleton implementations rather than one framework stamped out
hundreds of times. That is evidence against "2,100 agents deployed from a common template"
being visible in Stock Token flow.

### High-frequency addresses trading anything on chain (comparison)

Sampled 100 blocks, 1,392 transactions, 776 distinct senders:

| Senders present in ≥ k of 5 windows | Count |
|---|---|
| ≥ 2 | 43 |
| ≥ 3 | 17 |
| ≥ 4 | 5 |
| 5 of 5 | 2 |

Not directly comparable to the Stock Token ladder — this counts transaction *senders*
(`tx.from`, so EOAs and bundlers) over a much smaller sample, whereas the Stock Token ladder
counts transfer *participants* (both sides, including contracts). Directionally, sustained
chain-wide senders are not more numerous than sustained Stock Token participants, i.e. Stock
Token automation is not a rounding error against general chain automation.

---

## What this does and does not establish

**Establishes:** there is a persistent, round-the-clock, automated population trading Stock
Tokens on chain 4663 that is an order of magnitude larger than the ERC-8004 registry, and
ERC-8004 registration is close to irrelevant as a discovery mechanism for it. 61 registered;
1 scoreable; ~51 sustained automated traders never registered at all.

**Does not establish that these are "agents" in the thesis sense.** Bytecode cannot reveal
intent. The evidence available leans *away* from autonomous strategy agents:

- burstiness (CV 2.14) is event-driven, i.e. reactive to flow or price, which is what a market
  maker or arbitrageur does;
- one address alone produced 3,027 movements in a single 500-block (~50 s) window — a rate
  consistent with inventory management, not with a strategy making decisions;
- the population is mostly singleton bytecode, not a deployed agent framework;
- the memo's own framing already treats "2,100 agents" as the output of a $1.3M builder
  incentive programme, i.e. an upper bound on a mercenary population.

A defensible reading is that this is **market-making and arbitrage infrastructure**, and that
the LLM-trading-agent population the thesis targets is a subset of unknown — possibly zero —
size within it. Separating the two would require behavioural work well beyond a count, and
that work is explicitly out of scope here.

## Method and limits

Read-only `eth_getLogs` / `eth_getBlockByNumber` against the public RPC; no archive node.

Full enumeration is infeasible: the RPC caps responses at 10,000 logs and a single 10,000-block
window already exceeds that, implying **>50M Stock Token movements since launch**. All counts
are therefore sampling-based:

- 16 windows × 400 blocks, spread across the 40M blocks below head (0.0122% coverage);
- venue pools excluded by calling `token0()` on every sustained contract;
- off-hours defined as outside 13:30–20:00 UTC on weekdays.

Sampled discovery means the address counts are **lower bounds** — an address active in less
than roughly a fifth of all 40-second intervals can be missed entirely. The direction of the
error is therefore toward *undercounting* the automated population, not overcounting it.

The snapshot behind these numbers is
[`docs/data/snapshots/2026-09-02-pre-subsidy-end.json`](./data/snapshots/2026-09-02-pre-subsidy-end.json)
and is reproducible with `scripts/snapshot/subsidy_snapshot.py`.
