# @rhchain/erc8056

The ERC-8056 ("Scaled UI Amount") adapter for Robinhood Chain stock tokens.

ERC-8056 scales the effective ("UI") amount of a token by a multiplier **without
rebasing**: `balanceOf()` and `totalSupply()` — the *raw* amount — stay fixed, so any
protocol that reads a raw balance and treats it as "shares" gets the wrong number of
underlying shares whenever the multiplier isn't 1.0. This package is the one place that
math lives.

All constants were verified on-chain on 2026-09-01 — see [`/docs/RECON.md §4`](../../docs/RECON.md).
The deployed transfer event is **`TransferWithScaledUI`**, *not* the EIP-8056 (Draft)
canonical `TransferWithUIAmount`; index by `TOPIC.TransferWithScaledUI`.

## API

```ts
import {
  toUnderlyingShares, fromUnderlyingShares, // raw <-> underlying shares (floor)
  rawBalanceValueUsd,                        // USD NAV — multiplier-free (see below)
  MultiplierHistory,                         // point-in-time multiplier lookup
  TOPIC, SELECTOR, SCALED_UI_ABI, WAD,       // verified constants
} from "@rhchain/erc8056";

// underlying shares = raw * uiMultiplier / 1e18
toUnderlyingShares(1_000000000000000000n, 4_000000000000000000n); // 4e18  (a 4.0 multiplier)

// USD value of a raw balance, given the token's Chainlink total-return answer (8-dec).
rawBalanceValueUsd(1_000000000000000000n, 31_563_860_540n); // 315.6386054e18  (AAPL)

// Multiplier in effect at a unix time, built from UIMultiplierUpdated events.
const h = MultiplierHistory.fromEvents(events);
h.multiplierAt(1_789_000_000n);
```

The on-chain twin of the conversion math is [`solidity/ScaledUIMath.sol`](./solidity/ScaledUIMath.sol);
it floors identically. The TypeScript property tests (`pnpm --filter @rhchain/erc8056 test`)
are the executable spec both sides must satisfy.

## Why NAV does not apply the multiplier

The Robinhood/Chainlink feed returns the **total-return price of one raw token, with the
multiplier already applied** (verbatim in [`/docs/RECON.md §3`](../../docs/RECON.md)). So:

```
usd = (rawBalance / 1e18) * (answer / 1e8)     // no uiMultiplier term
```

`rawBalanceValueUsd` takes no multiplier argument by design. Double-applying it — valuing
*underlying shares* with a *total-return* price — is the single most likely accounting bug
here, so it is structurally impossible in this API and pinned by the property test
*"value is independent of the multiplier"*. A corollary matters for the scoreboard: an
agent's NAV is **continuous across a corporate action** — a multiplier step alone creates
no artificial jump.

## What a multiplier step does to a constant-product AMM

Take a Uniswap-v3/-v2-style pool of `(STOCK_raw, USDG)`. The pool never consults an oracle;
it only knows its reserves. Its price of a raw token is `P_pool = R_usdg / R_stock`. The
*fair* price of a raw token is the total-return feed, `P = underlying_price × multiplier / 1e18`.

When the multiplier steps by ratio `r`, what happens depends on whether the underlying price
moves to offset it **at the same instant**:

- **A split (e.g. 10:1).** The multiplier goes ×10 **and** the underlying share price goes
  ÷10. Fair per-raw-token price `P = (underlying/10) × (10) = underlying` — **unchanged**
  (`r = 1`). And because raw balances never rebase, the pool's reserves don't move either.
  **The pool is structurally immune to splits: LP loss ≈ 0.** This is the whole point of a
  non-rebasing multiplier.

- **A reinvested dividend (e.g. +1%).** The multiplier steps +1% at the on-chain
  `effectiveAt`, but the market's ex-dividend price drop happens on the ex-date and the feed
  only re-ticks on its heartbeat/deviation. In the gap, the fair per-raw-token price is ~1%
  above the pool price with nothing on the pool having changed — so `r ≈ 1.01` of **genuine,
  uncompensated** mispricing, which arbitrageurs take from LPs.

**Arbitrage loss for a fair-price jump of ratio `r`** (constant product `x·y=k`): arbers move
the pool to the new price via reserves `x' = x/√r`, `y' = y·√r`. Marking both at the new
price, the value they extract is

```
LP_loss / pool_value = (√r − 1)²  / 2
```

(derivation in the module doc). Applying it:

| Event | Effective `r` seen by the pool | LP loss (fraction of pool value) |
|---|---|---|
| **1% reinvested dividend** | 1.01 (uncompensated) | `(√1.01−1)²/2` ≈ **1.24×10⁻⁵ ≈ 0.00124%** (~0.12 bps) |
| **10:1 split** | 1.0 (compensated; raw doesn't rebase) | **≈ 0** |
| 10:1 split, *worst-case feed desync* | up to 10 | `(√10−1)²/2` ≈ 2.34 — i.e. the token side is essentially **drained**; a bound, not an expectation |

Takeaways, all of which the indexer/metrics rely on:
1. Splits are a non-event for pools; **reinvested dividends** are the real (small) LP hazard,
   and only for the window between `effectiveAt` and the feed re-aligning.
2. `effectiveAt` is **known in advance** (`newUIMultiplier()`/`effectiveAt()` and the
   `UIMultiplierUpdated(effectiveAtTimestamp)` event), so pools can pause/oracle-gate around
   it and the scoreboard can **exclude fills inside the mispricing window** from slippage.
3. Because the arbitrage flows *through the pool*, the pool mid is a biased execution
   benchmark exactly when it matters — which is why the scoreboard measures slippage against
   the **Chainlink mid**, never the pool price.
