import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  priceAsOf,
  priceStaleness,
  execPriceUsdPerToken,
  slippageBps,
  type PricePoint,
} from "../src/pricing.js";

describe("priceAsOf (point-in-time)", () => {
  const pts: PricePoint[] = [
    { updatedAt: 100, answer: 10n },
    { updatedAt: 200, answer: 20n },
    { updatedAt: 300, answer: 30n },
  ];

  it("returns null before the first update", () => {
    expect(priceAsOf(pts, 99)).toBeNull();
    expect(priceStaleness(pts, 99)).toBeNull();
  });

  it("returns the latest answer at-or-before t", () => {
    expect(priceAsOf(pts, 100)).toBe(10n);
    expect(priceAsOf(pts, 199)).toBe(10n);
    expect(priceAsOf(pts, 200)).toBe(20n);
    expect(priceAsOf(pts, 10_000)).toBe(30n);
    expect(priceStaleness(pts, 250)).toBe(50);
  });

  it("[property] never uses an update with updatedAt > t", () => {
    const arb = fc
      .array(
        fc.record({ updatedAt: fc.integer({ min: 0, max: 100000 }), answer: fc.bigInt({ min: 1n, max: 10n ** 12n }) }),
        { maxLength: 40 },
      )
      .map((a) => {
        const seen = new Set<number>();
        return a
          .filter((p) => (seen.has(p.updatedAt) ? false : (seen.add(p.updatedAt), true)))
          .sort((x, y) => x.updatedAt - y.updatedAt);
      });
    fc.assert(
      fc.property(arb, fc.integer({ min: 0, max: 100000 }), (points, t) => {
        const got = priceAsOf(points, t);
        let expected: bigint | null = null;
        for (const p of points) {
          if (p.updatedAt <= t) expected = p.answer;
          else break;
        }
        expect(got).toBe(expected);
      }),
    );
  });
});

describe("execPriceUsdPerToken", () => {
  it("computes USD/token at 8 decimals from raw pool amounts (USDG 6-dec)", () => {
    // Sold 2 whole tokens (2e18) for 631.277 USDG (6-dec => 631277000).
    // price = 631.277 / 2 = 315.6385 USD/token => 8-dec = 31563850000
    const price = execPriceUsdPerToken({
      stockAmountRaw: 2n * 10n ** 18n,
      quoteAmountRaw: 631_277_000n,
      stockDecimals: 18,
      quoteDecimals: 6,
      outDecimals: 8,
    });
    expect(price).toBe(31_563_850_000n);
  });

  it("throws on a zero stock amount", () => {
    expect(() =>
      execPriceUsdPerToken({ stockAmountRaw: 0n, quoteAmountRaw: 1n, stockDecimals: 18, quoteDecimals: 6 }),
    ).toThrow(RangeError);
  });
});

describe("slippageBps", () => {
  it("is zero at the mid and signed away from it", () => {
    expect(slippageBps(100n, 100n)).toBe(0);
    // exec 1% above mid => +100 bps
    expect(Math.round(slippageBps(101n, 100n))).toBe(100);
    // exec 1% below mid => -100 bps
    expect(Math.round(slippageBps(99n, 100n))).toBe(-100);
  });

  it("throws on a non-positive mid", () => {
    expect(() => slippageBps(1n, 0n)).toThrow(RangeError);
  });
});
