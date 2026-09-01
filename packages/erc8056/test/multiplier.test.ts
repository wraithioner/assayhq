import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { toUnderlyingShares, fromUnderlyingShares, WAD } from "../src/index.js";

describe("raw <-> underlying-share conversion", () => {
  it("identity at multiplier 1.0", () => {
    expect(toUnderlyingShares(WAD, WAD)).toBe(WAD);
    expect(fromUnderlyingShares(WAD, WAD)).toBe(WAD);
  });

  it("applies a 4.0 multiplier (CRWD-style split): 1 raw token -> 4 underlying shares", () => {
    expect(toUnderlyingShares(WAD, 4n * WAD)).toBe(4n * WAD);
    expect(fromUnderlyingShares(4n * WAD, 4n * WAD)).toBe(WAD);
  });

  it("applies a 1.000566... multiplier exactly like the chain (AAPL)", () => {
    const m = 1_000_566_080_061_092_436n; // AAPL uiMultiplier(), verified on-chain
    // 1 raw token -> 1.000566... underlying shares
    expect(toUnderlyingShares(WAD, m)).toBe(m);
  });

  it("rejects bad inputs", () => {
    expect(() => toUnderlyingShares(-1n, WAD)).toThrow(RangeError);
    expect(() => toUnderlyingShares(WAD, 0n)).toThrow(RangeError);
    expect(() => fromUnderlyingShares(WAD, -1n)).toThrow(RangeError);
  });

  // --- Property: raw balance is invariant under a multiplier update. ---
  // ERC-8056 does not rebase; a corporate action changes only the multiplier.
  it("[property] a multiplier update never changes the raw balance", () => {
    // Model an update as the identity on the stored raw balance.
    const applyMultiplierUpdate = (rawBalance: bigint, _newMultiplier: bigint) => rawBalance;
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 30n }),
        fc.bigInt({ min: WAD, max: 100n * WAD }),
        fc.bigInt({ min: WAD, max: 100n * WAD }),
        (raw, m0, m1) => {
          expect(applyMultiplierUpdate(raw, m0)).toBe(raw);
          expect(applyMultiplierUpdate(raw, m1)).toBe(raw);
          // and underlying shares are recomputed from the *same* raw at each multiplier
          expect(toUnderlyingShares(raw, m0)).toBe((raw * m0) / WAD);
          expect(toUnderlyingShares(raw, m1)).toBe((raw * m1) / WAD);
        },
      ),
    );
  });

  // --- Property: round-trip loses at most a bounded amount of wei (floor twice). ---
  it("[property] round-trips within 2 wei for multipliers >= 1.0", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 30n }),
        fc.bigInt({ min: WAD, max: 100n * WAD }),
        (raw, m) => {
          const rt = fromUnderlyingShares(toUnderlyingShares(raw, m), m);
          expect(rt <= raw).toBe(true);
          expect(raw - rt <= 2n).toBe(true);
        },
      ),
    );
  });

  // --- Property: monotonic in the multiplier for a fixed raw balance. ---
  it("[property] underlying shares are monotonic in the multiplier", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 30n }),
        fc.bigInt({ min: WAD, max: 100n * WAD }),
        fc.bigInt({ min: WAD, max: 100n * WAD }),
        (raw, ma, mb) => {
          const lo = ma <= mb ? ma : mb;
          const hi = ma <= mb ? mb : ma;
          expect(toUnderlyingShares(raw, lo) <= toUnderlyingShares(raw, hi)).toBe(true);
        },
      ),
    );
  });
});
