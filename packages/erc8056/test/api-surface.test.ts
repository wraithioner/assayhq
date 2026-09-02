import { describe, it, expect } from "vitest";
import {
  WAD,
  TOKEN_DECIMALS,
  FEED_DECIMALS,
  TOPIC,
  SELECTOR,
  EIP_CANONICAL_TRANSFER_WITH_UI_AMOUNT_TOPIC,
  multiplierToFloat,
  rawBalanceValueUsd,
  rawBalanceValueUsdExact,
  MultiplierHistory,
} from "../src/index.js";

/**
 * Completes coverage of the public surface — every exported function, every
 * documented default, and every guard on the conversion path.
 */
describe("multiplierToFloat (display helper)", () => {
  it("renders fixed point as a human number", () => {
    expect(multiplierToFloat(WAD)).toBe(1);
    expect(multiplierToFloat(4n * WAD)).toBe(4);
    expect(multiplierToFloat(1_000_566_080_061_092_436n)).toBeCloseTo(1.00056608, 8);
  });
});

describe("valuation defaults and guards", () => {
  it("defaults to 18-dec token / 8-dec feed / 18-dec output", () => {
    const answer = 31_563_860_540n;
    const withDefaults = rawBalanceValueUsd(WAD, answer);
    const explicit = rawBalanceValueUsd(WAD, answer, {
      tokenDecimals: TOKEN_DECIMALS,
      feedDecimals: FEED_DECIMALS,
      outputDecimals: 18,
    });
    expect(withDefaults).toBe(explicit);
  });

  it("honours non-default decimals", () => {
    // 6-dec token, 8-dec feed, 8-dec output: 1 whole token at $2 => 2e8
    expect(
      rawBalanceValueUsd(1_000_000n, 200_000_000n, {
        tokenDecimals: 6,
        feedDecimals: 8,
        outputDecimals: 8,
      }),
    ).toBe(200_000_000n);
  });

  it("rejects a negative or fractional decimals argument", () => {
    expect(() => rawBalanceValueUsd(WAD, 1n, { outputDecimals: -1 })).toThrow(RangeError);
    expect(() => rawBalanceValueUsd(WAD, 1n, { outputDecimals: 1.5 })).toThrow(RangeError);
  });

  it("exact-rational form takes the same defaults and guards", () => {
    const a = rawBalanceValueUsdExact(WAD, 100_000_000n);
    const b = rawBalanceValueUsdExact(WAD, 100_000_000n, { tokenDecimals: 18, feedDecimals: 8 });
    expect(a).toEqual(b);
    expect(a.den).toBe(10n ** 26n);
    expect(rawBalanceValueUsdExact(WAD, 100_000_000n, { tokenDecimals: 6, feedDecimals: 2 }).den).toBe(
      10n ** 8n,
    );
    expect(() => rawBalanceValueUsdExact(-1n, 1n)).toThrow(RangeError);
    expect(() => rawBalanceValueUsdExact(1n, 0n)).toThrow(RangeError);
  });
});

describe("MultiplierHistory edge cases", () => {
  it("a later update at the same effectiveAt replaces the earlier one", () => {
    const h = new MultiplierHistory(WAD, [
      { newMultiplier: 2n * WAD, effectiveAt: 100n },
      { newMultiplier: 3n * WAD, effectiveAt: 100n },
    ]);
    expect(h.multiplierAt(100n)).toBe(3n * WAD);
    expect(h.changes()).toEqual([{ effectiveAt: 100n, multiplier: 3n * WAD }]);
  });

  it("exposes changes() without the synthetic genesis point", () => {
    expect(new MultiplierHistory().changes()).toEqual([]);
    const h = new MultiplierHistory(WAD, [{ newMultiplier: 2n * WAD, effectiveAt: 5n }]);
    expect(h.changes()).toEqual([{ effectiveAt: 5n, multiplier: 2n * WAD }]);
  });
});

describe("published constants", () => {
  it("exposes the deployed topic, not the EIP's canonical name", () => {
    expect(TOPIC.TransferWithScaledUI).toBe(
      "0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802",
    );
    expect(TOPIC.TransferWithScaledUI).not.toBe(EIP_CANONICAL_TRANSFER_WITH_UI_AMOUNT_TOPIC);
    expect(SELECTOR.uiMultiplier).toBe("0xa60bf13d");
    for (const t of Object.values(TOPIC)) expect(t).toMatch(/^0x[0-9a-f]{64}$/);
    for (const s of Object.values(SELECTOR)) expect(s).toMatch(/^0x[0-9a-f]{8}$/);
  });
});
