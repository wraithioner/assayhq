import { describe, expect, it } from "vitest";
import { capacityDecaySlope, maxDrawdown } from "../src/statistics.js";

describe("metric statistics", () => {
  it("computes drawdown from the running peak", () => {
    expect(maxDrawdown([1, 1.2, 0.9, 1.1])).toBeCloseTo(0.25, 12);
  });

  it("reports capacity decay as bps per 10x notional", () => {
    const slope = capacityDecaySlope([
      { notionalUsd: 100, adverseSlippageBps: 2 },
      { notionalUsd: 1_000, adverseSlippageBps: 7 },
      { notionalUsd: 10_000, adverseSlippageBps: 12 },
    ]);
    expect(slope).toBeCloseTo(5, 12);
  });
});
