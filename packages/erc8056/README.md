# erc8056

Reference math for **ERC-8056 (“Scaled UI Amount”)** tokens: raw ↔ underlying-share
conversion, a point-in-time corporate-action multiplier history, and valuation that is
provably independent of the multiplier.

**Zero runtime dependencies. MIT licensed.** Ships TypeScript types and a matching Solidity
library so on-chain and off-chain accounting agree to the wei.

```bash
npm install @rhchain/erc8056
```

---

## The mechanic

An ERC-8056 token carries a second quantity alongside the ordinary ERC-20 balance: an
18-decimal fixed-point **UI multiplier**.

```
underlying shares = raw amount × uiMultiplier ÷ 1e18
```

A corporate action — a reinvested dividend, a stock split — does not move anyone’s tokens.
It updates one number on the contract and emits:

```solidity
event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
```

The multiplier may be scheduled ahead of time (`newUIMultiplier()` / `effectiveAt()`), so the
value in force at a given moment is “the last update whose `effectiveAt` ≤ now” — never the
latest one you happen to have fetched.

## Why `balanceOf()` misleads

**The token never rebases.** After a 4:1 split your `balanceOf` is *the same integer it was
before* — but each of those raw units now represents four underlying shares.

```ts
import { toUnderlyingShares, WAD } from "@rhchain/erc8056";

const raw = WAD;                       // balanceOf() -> 1.0, before AND after the split
toUnderlyingShares(raw, WAD);          // 1e18  → 1 share   (multiplier 1.0)
toUnderlyingShares(raw, 4n * WAD);     // 4e18  → 4 shares   (multiplier 4.0, real: CRWD)
```

So any protocol that reads a raw balance and calls it “shares” is wrong by a factor of the
multiplier — silently, and only for the assets that have had a corporate action. It will not
throw. It will just be wrong, and only sometimes, which is worse.

Three concrete traps:

1. **Collateral valuation.** Treating raw as shares under-counts a post-split position 4×.
2. **`totalSupply` accounting.** Supply looks flat across a split that quadrupled the claim.
3. **Double-counting the multiplier.** If your price feed is already *total-return* (as
   Robinhood Chain’s Chainlink feeds are — the answer is the price of one **raw token**, with
   the multiplier already applied), then converting to shares *and* using that feed
   over-values the position by the multiplier again. This library makes that mistake
   structurally impossible: `rawBalanceValueUsd()` takes no multiplier argument.

```ts
import { rawBalanceValueUsd } from "@rhchain/erc8056";
// value a raw balance with a total-return answer — no multiplier term, by design
rawBalanceValueUsd(WAD, 31_563_860_540n); // 315.6386054e18  ($315.6386054)
```

A useful corollary for anyone building a portfolio tracker: **a multiplier step alone does
not move NAV.** Share count jumps, per-share price divides, USD value is continuous.

## What a multiplier step does to a constant-product AMM

A Uniswap-style pool holds *raw* tokens and consults no oracle. Its price is `y/x`. The fair
price of a raw token is the total-return feed, `underlying_price × multiplier ÷ 1e18`.

When the multiplier steps by ratio `r`, what happens depends entirely on whether the
underlying price moves to offset it **at the same instant**:

- **A split (e.g. 10:1).** Multiplier ×10, underlying share price ÷10. Fair per-raw-token
  price is *unchanged*, and since raw balances never rebase, the pool’s reserves don’t move
  either. **The pool is structurally immune: `r = 1`, LP loss ≈ 0.** This is the whole point
  of a non-rebasing multiplier.
- **A reinvested dividend.** The multiplier steps up at the on-chain `effectiveAt`, but the
  market’s ex-dividend price drop happened on the ex-date and the feed only re-ticks on its
  heartbeat/deviation. In that gap the fair price is genuinely above the pool price with
  nothing on the pool having changed — real, uncompensated mispricing that arbitrageurs take
  from LPs.

For a fair-price jump of ratio `r`, arbitrageurs move a constant-product pool to the new
price via reserves `x' = x/√r`, `y' = y·√r`. Marking both sides at the new price, the value
they extract is:

```
LP loss / pool value = (√r − 1)² / 2
```

### Worked numbers — from real on-chain history

Every figure below is computed from an actual `UIMultiplierUpdated` event on Robinhood Chain
mainnet and is **pinned by tests** (`test/onchain-fixture.test.ts`), so this table cannot
drift from the chain.

| Event | `r` | LP loss (fraction) | in bps |
|---|---|---|---|
| **Canonical 1% dividend** | 1.01 | `1.2438 × 10⁻⁵` | **0.124 bps** |
| CCL distribution — real, block 50,955,407 | 1.021486444855206408 | `5.7097 × 10⁻⁵` | 0.571 bps |
| SGOV distribution — real, block 51,269,236 | 1.002113947879 | `5.580 × 10⁻⁷` | 0.006 bps |
| AAPL dividend — real, block 36,345,344 | 1.000566080061092436 | `4.00 × 10⁻⁸` | 0.0004 bps |
| **10:1 split, compensated (reality)** | **1.0** | **0** | **0 bps** |
| 10:1 split, *uncompensated* — a bound, not an expectation | 10 | `2.3377` | — |
| CRWD 4:1 split, *uncompensated* bound — real, block 978,630 | 4 | `0.5000` | — |

Read that table carefully, because the headline is counter-intuitive:

- **Dividends are the real hazard, and they are tiny.** A 1% reinvested dividend costs LPs
  about **0.12 bps** of pool value. The largest distribution ever emitted on this chain (CCL,
  +2.15%) costs **0.57 bps**.
- **Splits are a non-event** — *provided* the feed and the multiplier move together. The
  `r = 10` row is what happens if they ever don’t: `(√10 − 1)²/2 ≈ 2.34`, which is not a
  “234% loss” so much as a statement that the token side of the pool is emptied into the
  arbitrageur. That is a bound on desynchronisation risk, not a prediction.
- Because `effectiveAt` is **known in advance**, a pool or an LP can pause, widen, or
  oracle-gate across the step. The risk is schedulable.

### Every corporate action ever emitted on Robinhood Chain

Scanned `block 0 → 52,428,883` — 17 events across 10 tokens. This is the complete set, and it
is committed as the test fixture (`test/fixtures/multiplier-history.json`).

| Token | Block | Multiplier | Kind |
|---|---|---|---|
| CRWD | 978,630 | 1.0 → 4.0 | 4:1 split |
| SGOV | 4,629,631 | 1.0 → 1.000957519891 | distribution |
| MU | 18,239,875 | 1.0 → 1.000074823219 | dividend |
| ORCL | 20,823,272 | 1.0 → 1.002210914971 | dividend |
| DELL | 26,853,518 | 1.0 → 1.000063708620 | dividend |
| ASML | 29,439,914 | 1.0 → 1.000101323251 | dividend |
| SGOV | 30,302,195 | 1.000957519891 → 1.002981519347 | distribution |
| COST | 32,889,913 | 1.0 → 1.000612040296 | dividend |
| AAPL | 36,345,344 | 1.0 → 1.000566080061 | dividend |
| CCL | 50,955,407 | 1.0 → 1.021486444855 | distribution |
| SGOV | 51,269,236 | 1.002981519347 → 1.005101770003 | distribution |

SGOV’s three-step chain is the cleanest illustration of the model: an ETF accruing
distributions purely through the multiplier, with the raw balance never once changing.

## API

```ts
import {
  toUnderlyingShares, fromUnderlyingShares,  // conversion (floors, matches Solidity)
  rawBalanceValueUsd, rawBalanceValueUsdExact, // multiplier-free valuation
  MultiplierHistory,                          // point-in-time multiplier lookup
  multiplierToFloat,                          // display only
  WAD, TOKEN_DECIMALS, FEED_DECIMALS,
  TOPIC, SELECTOR, SCALED_UI_ABI,             // verified event/selector constants
} from "@rhchain/erc8056";
```

**Point-in-time history**, built straight from decoded events. `multiplierAt()` never
consults an update whose `effectiveAt` is after the query time, and `fromEvents()` validates
that each event’s `oldMultiplier` matches the running value — a broken chain throws instead
of silently mis-valuing:

```ts
const h = MultiplierHistory.fromEvents(events);
h.multiplierAt(1_788_220_825n); // the value in force at that second
h.current();
h.changes();
```

### A note on event naming

The deployed contracts emit **`TransferWithScaledUI`**
(`0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802`), **not** the
EIP-8056 draft’s canonical `TransferWithUIAmount`. Indexers must filter on the former; the
latter topic does not appear on chain. Both are exported so you can assert the distinction:

```ts
TOPIC.TransferWithScaledUI !== EIP_CANONICAL_TRANSFER_WITH_UI_AMOUNT_TOPIC; // true
```

Every raw `Transfer` is paired 1:1 with a `TransferWithScaledUI` carrying `uiValue`, so an
indexer can read the underlying-share amount directly rather than recomputing it — which
also removes the off-by-one risk at the exact block a multiplier changes.

## Solidity

[`solidity/ScaledUIMath.sol`](./solidity/ScaledUIMath.sol) is the on-chain twin. It floors
identically (`mulDiv` truncation), so a contract and an off-chain indexer agree exactly. The
TypeScript property tests are the shared specification for both.

## Testing

```bash
npm test          # 42 tests
npm run coverage  # 100% statements / branches / functions / lines
```

Coverage is 100% on the conversion path and every other module. The suite includes
property-based tests (`fast-check`) for the invariants that matter:

- a multiplier update **never** changes the raw balance;
- conversion round-trips to within 1–2 wei (bounded double-flooring);
- underlying shares are monotonic in the multiplier;
- valuation is **independent of the multiplier**, and double-applying it demonstrably
  overstates NAV (4× on a real CRWD-style multiplier);
- the point-in-time history never looks ahead.

## Licence

MIT.
