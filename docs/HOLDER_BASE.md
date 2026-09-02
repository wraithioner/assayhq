# The Stock Token holder base on Robinhood Chain

**A distribution measurement. Chain 4663, measured 2 September 2026 at head block
52,664,749.** Chain launched 1 July 2026. Read-only; no product code was involved.

**Headline.** **237,903** distinct addresses hold a non-zero balance of at least one of the
194 Stock Tokens. Total value in the 35 tokens that have a Chainlink feed is
**$70,901,469**, but **$40,834,946 of that (57.6%) sits in trading-venue contracts**, not in
wallets. Excluding venue infrastructure leaves **$30,066,523** spread over **237,623**
addresses — a **mean of $127 and a median of $0.50**. **1,228** addresses hold more than
$1,000; **157** hold more than $10,000; **25** hold more than $100,000.

**Enumeration is complete: all 193 indexed tokens, all 919,694 holder positions. Nothing here
is sampled or extrapolated except where §6, §7 and §8 say so explicitly.**

**Scope note.** Stock Tokens are a minor part of this chain. The $70.9M measured here sits
against $19.2B of 30-day DEX volume and $157.9M of 30-day protocol fees, almost all of it
memecoin launchpads and DEX trading in other tokens — see [`CHAIN_SCALE.md`](./CHAIN_SCALE.md).
Nothing below changes; it simply is not a measurement of the chain.

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

**Coverage: complete. All 193 indexed tokens, 919,694 holder positions, nothing missed.**

| | |
|---|---|
| Tokens indexed as tokens by Blockscout | **193** of 194 (BND returns 404 and is excluded) |
| Tokens fully enumerated | **193** — every one |
| Holder positions enumerated | **919,694** |
| Distinct addresses | **237,903** — exact |
| Maximum value missed | **$0** |

The enumerated total (919,694) slightly exceeds the sum of the per-token `holders_count`
counters (914,018), because those counters are cached and lag the live list by a little. The
enumerated lists, not the counters, are the source of record here.

**One timing caveat.** The full pass took several hours, so this is a union over that window
rather than a single-block snapshot: an address that opened a position mid-pass is included,
and balances for different tokens were read minutes to hours apart. Prices are pinned to one
block. Given the churn on this chain, treat the address count as accurate to a few tenths of a
percent, not to the unit.

Prices are `latestRoundData()` from the 35 `rh_total_return` Chainlink proxies, read at the
head block. Per `RECON.md` D-0.6 these feeds are total-return and already multiplier-adjusted,
so `usd = raw / 1e18 × answer / 1e8` and the ERC-8056 multiplier is **not** applied again.
**The 159 tokens without a feed are never assigned a dollar value**; they are reported by
position count only (§5).

## 1. How many addresses hold a Stock Token?

| | |
|---|---|
| Distinct addresses, non-zero balance, any Stock Token | **237,903** |
| …excluding venue infrastructure | **237,623** |
| …holding at least one *feed-priced* token | **196,329** |
| …holding **only** feed-less tokens (no USD value assignable) | **30,678** |
| Holder positions (address × token pairs) | **919,694** |
| Mean tokens held per address | **3.87** |
| Addresses holding exactly one token | **141,029 (59.4%)** |

The gap between 919,694 positions and 237,903 addresses is the single most important thing to
know before quoting any "holders" number for this chain: **an address holds 3.87 tokens on
average, so summing per-token holder counts overstates the population by nearly 4×.**

## 2. Balance distribution in USD

Excluding venue infrastructure (280 addresses, §4). Value covers the 35 feed-priced tokens.

| Bucket | Addresses | Share |
|---|---:|---:|
| exactly $0 (see note) | 41,574 | 17.50% |
| $0 – $100 | **186,923** | 78.66% |
| $100 – $1,000 | 7,898 | 3.32% |
| $1,000 – $10,000 | 1,071 | 0.45% |
| $10,000 – $100,000 | 132 | 0.056% |
| $100,000 – $1,000,000 | 21 | 0.009% |
| > $1,000,000 | 4 | 0.002% |

The $0 row is **30,678** addresses holding only feed-less tokens (no price exists for them)
plus **10,896** holding priced dust below $10⁻¹⁰, which the stored precision rounds to zero. It
is not 41,574 empty wallets — every address counted anywhere in this document has a non-zero
token balance.

Cumulative, which is the form the question was asked in:

| Threshold | Addresses above it | Share |
|---|---:|---:|
| > $0 | **196,049** | 82.50% |
| > $100 | **9,126** | 3.84% |
| > $1,000 | **1,228** | 0.52% |
| > $10,000 | **157** | 0.066% |
| > $100,000 | **25** | 0.011% |
| > $1,000,000 | **4** | 0.002% |

| | Excluding infrastructure | All holders |
|---|---:|---:|
| Total value | **$30,066,523** | $70,901,469 |
| **Mean** (all addresses) | **$126.53** | $298.03 |
| **Median** (all addresses) | **$0.50** | $0.51 |
| Mean (value > $0 only) | $153.36 | $361.14 |
| Median (value > $0 only) | $1.14 | $1.15 |

The distribution is dust-dominated. The median holder owns **50 cents** of Stock Tokens; the
mean is 251× the median. Fully **78.7%** of addresses hold under $100, and the deepest tail
holds literal single wei — the last rows of a token list are balances of `1`, i.e. 10⁻¹⁸ of a
token. Note that the counts above $100 are **identical** to those measured at 92.9% coverage:
completing the enumeration added 21,292 addresses and only $2,058 of value, all of it dust.

## 3. Concentration

| Share of total value held by | Excluding infrastructure | All holders |
|---|---:|---:|
| Top 1 address | **16.03%** | 35.96% |
| Top 10 | **56.12%** | 66.67% |
| Top 100 | **76.18%** | 85.79% |
| Top 1% (n = 2,376 / 2,379) | **91.17%** | 96.06% |
| Top 10% (n = 23,762 / 23,790) | **98.22%** | 99.20% |

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
| Priced positions (35 feed-covered tokens) | **788,553** |
| Feed-less positions (159 tokens) | **130,256** |
| Addresses holding ≥1 feed-less token | **78,273** |
| Addresses holding **only** feed-less tokens | **30,678** |

So 85.8% of positions are priceable, but **30,678 addresses (12.9%) have no assignable dollar
value at all** and sit in the "$0" row of §2 by construction, not because they are empty.

## 6. EOAs vs contracts

Blockscout's `is_contract` marks 123,664 of the 237,903 addresses (52%) as contracts. **That
number is misleading and should not be used.** Sampling the bytecode shows the dominant
"contract" is 23 bytes beginning `0xef0100` — an **EIP-7702 delegation designator**. These are
ordinary EOAs that have delegated to a smart-account implementation; they are user wallets.
The delegation targets are verified as `Simple7702Account` (the ERC-4337 reference account),
`EIP7702StatelessDeleGator` (MetaMask's delegation toolkit) and `SemiModularAccount7702`
(Alchemy).

Verification of the label itself: of 50 sampled `is_contract=1` addresses, 50 had bytecode; of
50 sampled `is_contract=0` addresses, **3 had bytecode** — a ~6% false-negative rate, so the
figures below are RPC-derived, not label-derived.

**Exact, for all 1,508 addresses above $1,000** (`eth_getCode` on every one):

| Kind | Count | Share |
|---|---:|---:|
| Plain EOA | 772 | 51.2% |
| EIP-7702 delegated EOA | 131 | 8.7% |
| Real contract | 605 | 40.1% |
| *(of which AMM pools)* | *171* | *11.3%* |

**Sampled, for the 236,395 addresses at or below $1,000** (uniform random n = 900, 95% CI):

| Kind | Share | Extrapolated |
|---|---:|---:|
| Plain EOA | 42.67% ± 3.23pp | ~100,900 |
| EIP-7702 delegated EOA | 32.00% ± 3.05pp | ~75,600 |
| Real contract | 25.33% ± 2.84pp | ~59,900 |

**About 75% of the holder base is a user wallet** (plain EOA or 7702-delegated), and roughly
25% is a genuine contract. Contract share rises with size: 40% above $1,000 versus 25% below.

## 7. Growth: distinct holders per week

Method: a uniform random sample of **500** non-infrastructure holders, drawn when 172,527 of
the eventual 237,623 had been enumerated (the remainder is deep-tail dust of AAPL, NVDA and
SPCX, so the sample under-represents that tail); for each, its ERC-20
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
| "Holders" | 328,000 | **237,903** distinct addresses (complete enumeration) |
| Holder *positions* (address × token) | — | **919,694** |
| Total value | $44M | **$70.9M** all holders / **$30.1M** excluding venue contracts |
| Average per holder | $134 | **$126.53** excluding venue contracts |

Three specific observations:

1. **My distinct-address count is ~27% below DWF's, five weeks later, during a period when the
   base was growing sharply.** That is not reconcilable as growth. Working backwards with the
   §7 cohort curve, only ~18% of today's holders had joined by end-July — roughly **43,000**
   distinct addresses at DWF's measurement date, about **7.6× below** their 328,000.
2. **The mean is close** — $134 versus $126.53 — but only against my *infrastructure-excluded*
   value. That is worth flagging rather than leaning on: their $44M/328k and my $30.1M/237.6k
   land in the same neighbourhood from different numerators and denominators.
3. **Their $44M is between my two totals.** Customer-held value today is $30.1M; adding venue
   contracts gives $70.9M. If DWF included AMM/venue balances (most dashboards do), their $44M
   on 27 July is consistent with $70.9M today.

The most likely explanations for the count gap, in order, are: DWF counted **per-token holder
positions** rather than distinct addresses (positions run 3.87× addresses here, and 328k
positions in July against 920k today is a plausible trajectory); or DWF counted **cumulative
addresses that ever received** a Stock Token, whereas this measures **current non-zero
balances**, so every address that has since sold is excluded. Given the flow on this chain
(≈11.5M movements per day, `MARKET_SIZE.md`), churn out of the holder set is likely large.

This cannot be settled from the source: the DWF figure is a social-media post with no stated
methodology, and the reporting explicitly cautions that "the figures refer to platform holders
and may include blockchain addresses rather than verified individual investors."

**Statement of agreement: it does not agree.** On distinct current holders I measure 237,903
against their 328,000 — about **27% lower**, and far lower on a like-for-like date basis.
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
