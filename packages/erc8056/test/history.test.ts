import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { MultiplierHistory, WAD } from "../src/index.js";

describe("MultiplierHistory (point-in-time)", () => {
  it("returns the initial multiplier when there are no updates", () => {
    const h = new MultiplierHistory();
    expect(h.multiplierAt(0n)).toBe(WAD);
    expect(h.multiplierAt(10n ** 12n)).toBe(WAD);
    expect(h.current()).toBe(WAD);
  });

  it("steps at the effective timestamp, not before", () => {
    const h = new MultiplierHistory(WAD, [
      { newMultiplier: 101n * WAD / 100n, effectiveAt: 100n },
      { newMultiplier: 102n * WAD / 100n, effectiveAt: 200n },
    ]);
    expect(h.multiplierAt(50n)).toBe(WAD);
    expect(h.multiplierAt(99n)).toBe(WAD);
    expect(h.multiplierAt(100n)).toBe((101n * WAD) / 100n);
    expect(h.multiplierAt(199n)).toBe((101n * WAD) / 100n);
    expect(h.multiplierAt(200n)).toBe((102n * WAD) / 100n);
    expect(h.multiplierAt(10n ** 9n)).toBe((102n * WAD) / 100n);
    expect(h.current()).toBe((102n * WAD) / 100n);
  });

  it("handles a CRWD-style 4.0 step scheduled for a future timestamp", () => {
    const T = 1_790_000_000n;
    const h = new MultiplierHistory(WAD, [{ newMultiplier: 4n * WAD, effectiveAt: T }]);
    expect(h.multiplierAt(T - 1n)).toBe(WAD);
    expect(h.multiplierAt(T)).toBe(4n * WAD);
  });

  it("accepts updates in any order (sorts by effectiveAt)", () => {
    const h = new MultiplierHistory(WAD, [
      { newMultiplier: 3n * WAD, effectiveAt: 300n },
      { newMultiplier: 2n * WAD, effectiveAt: 200n },
    ]);
    expect(h.multiplierAt(250n)).toBe(2n * WAD);
    expect(h.multiplierAt(350n)).toBe(3n * WAD);
  });

  it("validates the old->new chain via fromEvents", () => {
    expect(() =>
      MultiplierHistory.fromEvents([
        { oldMultiplier: WAD, newMultiplier: 2n * WAD, effectiveAtTimestamp: 100n },
        // broken: oldMultiplier should be 2*WAD here
        { oldMultiplier: WAD, newMultiplier: 3n * WAD, effectiveAtTimestamp: 200n },
      ]),
    ).toThrow(/chain broken/);
  });

  it("rejects non-positive multipliers", () => {
    expect(() => new MultiplierHistory(0n)).toThrow(RangeError);
    expect(() => new MultiplierHistory(WAD, [{ newMultiplier: 0n, effectiveAt: 1n }])).toThrow(
      RangeError,
    );
  });

  // --- Property: no lookahead. multiplierAt(t) equals the last update with
  //     effectiveAt <= t, and never one with effectiveAt > t. ---
  it("[property] never consults an update effective after the query time", () => {
    const updateArb = fc
      .array(
        fc.record({
          newMultiplier: fc.bigInt({ min: WAD, max: 10n * WAD }),
          effectiveAt: fc.bigInt({ min: 0n, max: 10n ** 6n }),
        }),
        { maxLength: 20 },
      )
      // unique, ascending effective times so the old->new chain is well defined
      .map((arr) => {
        const seen = new Set<bigint>();
        return arr
          .filter((u) => (seen.has(u.effectiveAt) ? false : (seen.add(u.effectiveAt), true)))
          .sort((a, b) => (a.effectiveAt < b.effectiveAt ? -1 : 1));
      });

    fc.assert(
      fc.property(updateArb, fc.bigInt({ min: 0n, max: 10n ** 6n }), (updates, t) => {
        const h = new MultiplierHistory(WAD, updates);
        // reference: linear scan
        let expected = WAD;
        for (const u of updates) {
          if (u.effectiveAt <= t) expected = u.newMultiplier;
          else break;
        }
        // The linear scan stops at the first effectiveAt > t, so equality here
        // is exactly the no-lookahead guarantee.
        expect(h.multiplierAt(t)).toBe(expected);
      }),
    );
  });
});
