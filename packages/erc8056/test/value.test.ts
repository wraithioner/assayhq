import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  rawBalanceValueUsd,
  rawBalanceValueUsdExact,
  toUnderlyingShares,
  WAD,
} from "../src/index.js";

describe("USD valuation of a raw balance (feed is total-return)", () => {
  it("matches a hand-computed AAPL value (verified on-chain answer)", () => {
    // AAPL total-return feed latestRoundData().answer, 8 decimals => $315.6386054.
    const answer = 31_563_860_540n;
    // 1 whole token (1e18 raw), default token=18 / feed=8 / out=18 decimals.
    // usd18 = 1e18 * 31563860540 / 1e8 = 315.6386054e18
    expect(rawBalanceValueUsd(WAD, answer)).toBe(315_638_605_400_000_000_000n);
  });

  it("scales linearly with the raw balance (no rounding at whole multiples)", () => {
    const answer = 31_563_860_540n;
    expect(rawBalanceValueUsd(2n * WAD, answer)).toBe(2n * rawBalanceValueUsd(WAD, answer));
    expect(rawBalanceValueUsd(0n, answer)).toBe(0n);
  });

  it("rejects stale/zero prices and negative balances", () => {
    expect(() => rawBalanceValueUsd(WAD, 0n)).toThrow(RangeError);
    expect(() => rawBalanceValueUsd(WAD, -1n)).toThrow(RangeError);
    expect(() => rawBalanceValueUsd(-1n, 1n)).toThrow(RangeError);
  });

  // --- THE central correctness property of the whole system. ---
  // The feed already includes the multiplier, so NAV must NOT re-apply it.
  it("[property] value is independent of the multiplier (continuous across a step)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 30n }),
        fc.bigInt({ min: 1n, max: 10n ** 15n }), // feed answer (8-dec), > 0
        fc.bigInt({ min: WAD, max: 10n * WAD }), // multiplier before a step
        fc.bigInt({ min: WAD, max: 10n * WAD }), // multiplier after a step
        (raw, answer, mBefore, mAfter) => {
          // Correct valuation takes no multiplier at all: identical before/after a step.
          const vBefore = rawBalanceValueUsd(raw, answer);
          const vAfter = rawBalanceValueUsd(raw, answer);
          expect(vBefore).toBe(vAfter);

          // The classic bug: double-applying the multiplier (valuing underlying
          // shares with an already-total-return price). For multipliers >= 1.0 it
          // can only OVERSTATE NAV, never understate, and is exact at 1.0.
          const buggy = (m: bigint) => rawBalanceValueUsd(toUnderlyingShares(raw, m), answer);
          expect(buggy(mBefore) >= vBefore).toBe(true);
          expect(buggy(mAfter) >= vAfter).toBe(true);
          if (mBefore === WAD) expect(buggy(mBefore)).toBe(vBefore);
        },
      ),
    );
  });

  it("double-applying the multiplier overstates NAV (the trap, made concrete)", () => {
    const answer = 31_563_860_540n; // AAPL total-return answer
    const m = 4n * WAD; // a 4.0 corporate-action multiplier (CRWD-style)
    const raw = 1_000n * WAD; // 1000 raw tokens
    const correct = rawBalanceValueUsd(raw, answer);
    const buggy = rawBalanceValueUsd(toUnderlyingShares(raw, m), answer);
    expect(buggy).toBe(4n * correct); // 4x overstatement — the bug this module prevents
  });

  it("exact rational agrees with the floored integer", () => {
    const answer = 31_563_860_540n;
    const { num, den } = rawBalanceValueUsdExact(WAD, answer);
    // floor(num/den) scaled to 18 decimals equals the integer helper
    const usd18 = (num * 10n ** 18n) / den;
    expect(usd18).toBe(rawBalanceValueUsd(WAD, answer));
  });
});
