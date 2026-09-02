# The Stock Token holder base on Robinhood Chain

**A distribution measurement. Chain 4663, measured 2 September 2026 at head block
52,664,749.** Chain launched 1 July 2026. Read-only; no product code was involved.

**Headline.** **216,611** distinct addresses hold a non-zero balance of at least one of the
194 Stock Tokens. Total value in the 35 tokens that have a Chainlink feed is
**$70,899,411**, but **$40,834,946 of that (57.6%) sits in trading-venue contracts**, not in
wallets. Excluding venue infrastructure leaves **$30,064,465** spread over **216,331**
addresses — a **mean of $139 and a median of $0.75**. **1,228** addresses hold more than
$1,000; **157** hold more than $10,000; **25** hold more than $100,000.

---

## Method and coverage

Balances were **not** reconstructed by replaying `Transfer` / `TransferWithScaledUI` logs.
Full log enumeration remains infeasible (>50M movements, and the RPC caps `eth_getLogs` at
10,000 logs; a full-range topic query returns `log query timed out`). Instead, current
balances were read directly from Blockscout's holder index, which is exact and already
reflects net position:

- `GET /api/v2/tokens/{token}` — exact `holders_count`, supply, decimals, for all 194 tokens.
- `GET /api/v2/tokens/{token}/holders` — the full holder list, 50 per page, cursor-paginated,
  **strictly value-descending** (verified on every completed file), with `is_contract` per
  address.

Two rate limits matter and are worth recording. The **legacy `/api` endpoint** (which supports
numeric `page`/`offset` and 1,000 rows per request) throttles hard and stayed banned for the
rest of the session after a few hundred requests. The **`/api/v2` endpoints** are on a
separate, far more permissive limit (measured 8.7 req/s with zero throttling). Blockscout
signals a soft rate limit as **HTTP 200 with `{"status":"0","message":"Too many requests"}`** —
parsed naively that looks like an empty page and silently truncates a holder list, so it is
treated as retryable here and no token is accepted unless its row count matches the declared
`holders_count`.

**Coverage: 849,298 of 914,018 holder positions (92.9%), 190 of 193 tokens complete.**

| | |
|---|---|
| Tokens fully enumerated | **190** of 193 indexed (BND is not indexed as a token by Blockscout; 404) |
| Tokens partially enumerated | **3** — AAPL, NVDA, SPCX (top 50,000 holders each) |
| Holder positions loaded | **849,298** of 914,018 declared |
| Distinct addresses | **216,611** — a **lower bound** |

Because the holder list is value-descending, a partial token is exactly its **top-K holders by
balance**, and every holder not fetched holds strictly less than the smallest holder fetched.
That gives a hard bound on missed value:

> **maximum value missed across all three partial tokens: $9,698 — 0.01% of the total.**

So **the value figures are effectively exact; only the address count is a lower bound.** To
size that gap, the same truncation was simulated on the eight fully-enumerated tokens with
≥20,000 holders: cutting them at the same depth loses between **1.2% and 5.0%** of the token's
holders as *newly distinct* addresses (one outlier, GME, at 25%). Applied to the ~64,700
unfetched positions, the true distinct count is likely **217,000–225,000**, and the arithmetic
upper bound is 281,331.

Prices are `latestRoundData()` from the 35 `rh_total_return` Chainlink proxies, read at the
head block. Per `RECON.md` D-0.6 these feeds are total-return and already multiplier-adjusted,
so `usd = raw / 1e18 × answer / 1e8` and the ERC-8056 multiplier is **not** applied again.
**The 159 tokens without a feed are never assigned a dollar value**; they are reported by
position count only (§5).

## 1. How many addresses hold a Stock Token?

| | |
|---|---|
| Distinct addresses, non-zero balance, any Stock Token | **216,611** (lower bound) |
| …excluding venue infrastructure | **216,331** |
| …holding at least one *feed-priced* token | **179,372** |
| …holding **only** feed-less tokens (no USD value assignable) | **31,663** |
| Holder positions (address × token pairs) | **849,298** of 914,018 declared |
| Mean tokens held per address | **3.57** |
| Addresses holding exactly one token | **124,749 (57.7%)** |

The gap between 914,018 positions and 216,611 addresses is the single most important thing to
know before quoting any "holders" number for this chain: **an address holds 4.2 tokens on
average, so summing per-token holder counts overstates the population by roughly 4×.**

## 2. Balance distribution in USD

Excluding venue infrastructure (280 addresses, §4). Value covers the 35 feed-priced tokens.

| Bucket | Addresses | Share |
|---|---:|---:|
| exactly $0 (see note) | 37,239 | 17.21% |
| $0 – $100 | **169,966** | 78.57% |
| $100 – $1,000 | 7,898 | 3.65% |
| $1,000 – $10,000 | 1,071 | 0.50% |
| $10,000 – $100,000 | 132 | 0.061% |
| $100,000 – $1,000,000 | 21 | 0.010% |
| > $1,000,000 | 4 | 0.002% |

The $0 row is **31,663** addresses holding only feed-less tokens (no price exists for them)
plus **5,576** holding priced dust below $10⁻¹⁰, which the stored precision rounds to zero. It
is not 37,239 empty wallets — every address counted anywhere in this document has a non-zero
token balance.

Cumulative, which is the form the question was asked in:

| Threshold | Addresses above it | Share |
|---|---:|---:|
| > $0 | **179,092** | 82.79% |
| > $100 | **9,126** | 4.22% |
| > $1,000 | **1,228** | 0.57% |
| > $10,000 | **157** | 0.073% |
| > $100,000 | **25** | 0.012% |
| > $1,000,000 | **4** | 0.002% |

| | Excluding infrastructure | All holders |
|---|---:|---:|
| Total value | **$30,064,465** | $70,899,411 |
| **Mean** (all addresses) | **$138.97** | $327.31 |
| **Median** (all addresses) | **$0.75** | $0.75 |
| Mean (value > $0 only) | $167.87 | $395.26 |
| Median (value > $0 only) | $1.57 | $1.58 |

The distribution is dust-dominated. The median holder owns **75 cents** of Stock Tokens; the
mean is 185× the median. Fully **78.6%** of addresses hold under $100, and the deepest tail
holds literal single wei — the last rows of a completed token list are balances of `1`, i.e.
10⁻¹⁸ of a token.

## 3. Concentration

| Share of total value held by | Excluding infrastructure | All holders |
|---|---:|---:|
| Top 1 address | **16.03%** | 35.96% |
| Top 10 | **56.13%** | 66.67% |
| Top 100 | **76.19%** | 85.80% |
| Top 1% (n = 2,163 / 2,166) | **90.82%** | 95.88% |
| Top 10% (n = 21,633 / 21,661) | **98.03%** | 99.16% |

Including venue contracts, **one address holds 36% of every Stock Token on the chain**. That
address is Uniswap V4's `PoolManager` (§4). Excluding infrastructure, the top 100 addresses
still hold 76% of customer-side value, and the top 1% hold 91%.

## 4. Venue infrastructure

The brief specified "contracts answering `token0()`". That test alone is **not sufficient on
this chain**, and using it alone would have misattributed $32M to customers:

- **Uniswap V4 keeps the liquidity of every pool in one singleton `PoolManager`.** It has no
  `token0()`. It is the largest Stock Token holder on the chain, holding 192 of the 194 tokens.
- **Lighter** custodies in a `ZkLighter` proxy — also no `token0()`.
- **V4 hook contracts** answer `poolManager()` instead.

So infrastructure here means: `token0()` responders **+** `poolManager()` responders **+**
contracts whose verified name identifies a venue.

| Detector | Addresses | Value held |
|---|---:|---:|
| `token0()` responders (V2/V3-style AMM pools) | 171 | $8,240,464 |
| Named venue singletons (Uniswap V4, Lighter, fee escrow) | 96 | $39,612,016 |
| `poolManager()` responders (V4 hooks) | 103 | $979,025 |
| **Union — venue infrastructure** | **280** | **$40,834,946** |
| Protocol vaults, reported separately, *not* excluded | 3 | $254,925 |

**57.6% of all Stock Token value on Robinhood Chain sits in 280 venue contracts.**

Largest:

| Address | Value | What it is |
|---|---:|---|
| `0x8366a39cc670b4001a1121b8f6a443a643e40951` | $25,495,350 | **Uniswap V4 `PoolManager`** (192 tokens) |
| `0x94bab9693ba2f6358507effcbd372b0660afff9d` | $5,702,941 | **`ZkLighter`** proxy |
| `0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3` | $971,689 | `UniswapV3Pool` |
| `0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e` | $396,707 | `V2FeeEscrow` |

Three large holders remain **unidentified** and are *not* excluded: `0x2f4579ca…` ($4.82M, 25
tokens), `0x51c72848…` ($1.48M, 14 tokens) and `0xdbca49d6…` ($0.40M). All three are
unverified contracts that answer none of `token0()`, `factory()`, `getReserves()`,
`poolManager()`, `asset()` or `owner()`. Holding 25 and 14 different tokens is not pool-shaped,
but they may still be venue or treasury infrastructure. If they are, customer-side value falls
by a further $6.7M to roughly $23.4M.

## 5. Feed-less holdings

Reported by position count only — no dollar value is imputed to a token without a feed.

| | |
|---|---:|
| Priced positions (35 feed-covered tokens) | **718,157** |
| Feed-less positions (159 tokens) | **130,256** |
| Addresses holding ≥1 feed-less token | **78,273** |
| Addresses holding **only** feed-less tokens | **31,663** |

So 84.6% of positions are priceable, but **31,663 addresses (14.6%) have no assignable dollar
value at all** and sit in the "$0" row of §2 by construction, not because they are empty.

## 6. EOAs vs contracts

Blockscout's `is_contract` marks 111,157 of the 216,611 addresses (51%) as contracts. **That
number is misleading and should not be used.** Sampling the bytecode shows the dominant
"contract" is 23 bytes beginning `0xef0100` — an **EIP-7702 delegation designator**. These are
ordinary EOAs that have delegated to a smart-account implementation; they are user wallets.
The delegation targets are verified as `Simple7702Account` (the ERC-4337 reference account),
`EIP7702StatelessDeleGator` (MetaMask's delegation toolkit) and `SemiModularAccount7702`
(Alchemy).

Verification of the label itself: of 50 sampled `is_contract=1` addresses, 50 had bytecode; of
50 sampled `is_contract=0` addresses, **3 had bytecode** — a ~6% false-negative rate, so the
figures below are RPC-derived, not label-derived.

**Exact, for all 1,505 addresses above $1,000** (`eth_getCode` on every one):

| Kind | Count | Share |
|---|---:|---:|
| Plain EOA | 772 | 51.3% |
| EIP-7702 delegated EOA | 130 | 8.6% |
| Real contract | 603 | 40.1% |
| *(of which AMM pools)* | *171* | *11.4%* |

**Sampled, for the 169,298 addresses at or below $1,000** (uniform random n = 900, 95% CI):

| Kind | Share | Extrapolated |
|---|---:|---:|
| Plain EOA | 47.00% ± 3.26pp | ~79,600 |
| EIP-7702 delegated EOA | 30.78% ± 3.02pp | ~52,100 |
| Real contract | 22.22% ± 2.72pp | ~37,600 |

**About 78% of the holder base is a user wallet** (plain EOA or 7702-delegated), and roughly
22% is a genuine contract. Contract share rises with size: 40% above $1,000 versus 22% below.

## 7. Growth: distinct holders per week

Method: a uniform random sample of **500** non-infrastructure holders; for each, its ERC-20
transfer history was paged back (newest first, up to 400 transfers) and the **oldest inbound
Stock Token transfer** taken as the address's first acquisition. 487 resolved; 13 showed no
inbound Stock Token transfer within the window; **127 were censored** (history not exhausted),
meaning their true first acquisition is *at or before* the date recorded.

Because censoring biases dates *later*, the uncensored subset is the unbiased read — and it
shows the same shape, so the result is not a censoring artefact.

| Week (Mon) | Uncensored (n=360) | All resolved (n=487) |
|---|---:|---:|
| 2026-07-06 | 3.3% | 2.5% |
| 2026-07-13 | 3.6% | 4.5% |
| 2026-07-20 | 7.5% | 7.6% |
| 2026-07-27 | 3.9% | 4.1% |
| 2026-08-03 | 6.1% | 6.4% |
| 2026-08-10 | 5.0% | 5.5% |
| 2026-08-17 | 6.9% | 7.0% |
| **2026-08-24** | **35.3%** | **34.9%** |
| **2026-08-31** (3 days only) | **28.3%** | **27.5%** |

**It is climbing steeply, not flattening.** **63.6%** of today's holders acquired their first
Stock Token in the final two weeks of the window, and the last bucket covers only three days
(31 Aug – 2 Sep). Roughly 18% of the current base existed by the end of July.

Sampling error on each weekly share is about ±2–5pp at n=360; the two-week spike is far outside
that.

## 8. Concentration check: are the >$1,000 wallets one entity?

Method: for **1,200 of the 1,337** non-infrastructure wallets above $1,000, the **sender of the
first inbound Stock Token transfer** was taken as the funding source. 1,184 resolved.

| | |
|---|---:|
| First funded **by venue infrastructure** (i.e. bought on-market) | **427 (36.1%)** |
| First funded by a non-venue address | **757 (63.9%)** |
| Distinct non-venue funders | **339** |
| Top 4 non-venue funders | 171 wallets (14.4%) |
| Top 10 non-venue funders | 271 wallets (22.9%) |

**No common-entity signal survives inspection.** Every concentrated funder is a protocol
contract, not a person's distribution wallet:

| Funder | Wallets | Identity |
|---|---:|---|
| `0x39adb8ac…` | 93 | `USDGBuyerDistributorV2` |
| `0xd3afeb2a…` | 86 | `V2FeeEscrow` (venue) |
| `0x8366a39c…` | 81 | Uniswap V4 `PoolManager` (venue) |
| `0x006102b1…` | 66 | `ERC1967Proxy` → **`ArcusSettlement`** (a DEX; missed by the venue filter) |
| `0xc94135b6…` | 39 | unverified contract |
| `0x65050a9b…` | 37 | `TransparentUpgradeableProxy` |

So the apparent clustering is **shared venues, not shared ownership**: these wallets bought
through the same handful of exchanges and settlement contracts. Spread over 339 distinct
funders with the largest genuinely non-venue funder accounting for 7.9%, there is no evidence
that the >$1,000 population is one entity. This method cannot detect entities that fund each
wallet from a fresh address, so it is a negative result, not proof of independence.

## 9. Cross-check against the DWF Labs figures

The claim, from a **DWF Labs post dated 27 July 2026**, reported by crypto.news: tokenized
equity holders crossed 752,000 across five platforms, of which "Robinhood … raced to **328K
holders**, 44% market share. But the total value has lagged at **$44M**." DWF computed an
average position of **$134**.

**The counts do not agree. The value figures roughly do, but only for one reading.**

| Measure | DWF, 27 Jul 2026 | This measurement, 2 Sep 2026 |
|---|---:|---:|
| "Holders" | 328,000 | **216,611** distinct addresses (lower bound; ~217–225k likely) |
| Holder *positions* (address × token) | — | **914,018** declared / 849,298 enumerated |
| Total value | $44M | **$70.9M** all holders / **$30.1M** excluding venue contracts |
| Average per holder | $134 | **$138.97** excluding venue contracts |

Three specific observations:

1. **My distinct-address count is ~34% below DWF's, five weeks later, during a period when the
   base was growing sharply.** That is not reconcilable as growth. Working backwards with the
   §7 cohort curve, only ~18% of today's holders had joined by end-July — roughly **39,000**
   distinct addresses at DWF's measurement date, about **8× below** their 328,000.
2. **The mean matches almost exactly** — $134 versus $138.97 — but only against my
   *infrastructure-excluded* value. That is a coincidence worth flagging rather than leaning
   on: their $44M/328k and my $30.1M/216.3k land in the same place from different numerators
   and denominators.
3. **Their $44M is between my two totals.** Customer-held value today is $30.1M; adding venue
   contracts gives $70.9M. If DWF included AMM/venue balances (most dashboards do), their $44M
   on 27 July is consistent with $70.9M today.

The most likely explanations for the count gap, in order, are: DWF counted **per-token holder
positions** rather than distinct addresses (positions run ~4.2× addresses here, and 328k
positions in July against 914k today is a plausible trajectory); or DWF counted **cumulative
addresses that ever received** a Stock Token, whereas this measures **current non-zero
balances**, so every address that has since sold is excluded. Given the flow on this chain
(≈11.5M movements per day, `MARKET_SIZE.md`), churn out of the holder set is likely large.

This cannot be settled from the source: the DWF figure is a social-media post with no stated
methodology, and the reporting explicitly cautions that "the figures refer to platform holders
and may include blockchain addresses rather than verified individual investors."

**Statement of agreement: it does not agree.** On distinct current holders I measure 216,611
against their 328,000 — about **34% lower**, and lower still on a like-for-like date basis.
On value my customer-side figure is **$30.1M** against their **$44M**, and my all-in figure is
**$70.9M**.

## Reproducing this

```bash
# exact per-token holder counts and supply (194 calls)
curl -sS -H 'user-agent: Mozilla/5.0' \
  https://robinhoodchain.blockscout.com/api/v2/tokens/0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9

# the holder list itself: 50/page, value-descending, cursor in next_page_params
curl -sS -H 'user-agent: Mozilla/5.0' \
  https://robinhoodchain.blockscout.com/api/v2/tokens/<token>/holders

# prices: latestRoundData() on each rh_total_return proxy from docs/data/chainlink-feeds.csv
curl -sS -X POST https://rpc.mainnet.chain.robinhood.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"<proxy>","data":"0xfeaf968c"},"latest"]}'
```

Send a browser `user-agent` — Blockscout returns a Cloudflare challenge otherwise. Use
`/api/v2`, not `/api`. Treat any 200 whose body carries `"status":"0"` as a rate limit and
retry; do not read it as an empty page.

Intermediates are committed under [`docs/data/holders/`](./data/holders): per-token metadata
and holder counts (`token_meta.json`), feed prices at the head block (`prices.json`),
per-token coverage and the missed-value bound (`build_summary.json`), the address
classification and sample (`classify.json`), the venue set (`infra.json`), the distribution
(`final_analysis.json`), and the cohort and funder samples (`cohorts_growth.json`,
`funder_split.json`).

**Scope note.** This document is a distribution measurement. It draws no product conclusion and
changes no scoring rule: the scoring universe is still ERC-8004 self-declared, scoring still
begins at an agent's registration block and is never backfilled, and nothing counted here
enters any leaderboard.
