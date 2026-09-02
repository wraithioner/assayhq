import { describe, expect, it } from "vitest";
import { asOfBlock, walletAsOf } from "../src/point-in-time.js";

describe("point-in-time lookups", () => {
  it("never returns a price snapshot from a future block", () => {
    const rows = [
      { blockNumber: 10, answer: 100n },
      { blockNumber: 20, answer: 200n },
      { blockNumber: 30, answer: 999_999n },
    ];
    expect(asOfBlock(rows, 9)).toBeNull();
    expect(asOfBlock(rows, 20)?.answer).toBe(200n);
    expect(asOfBlock(rows, 29)?.answer).toBe(200n);
  });

  it("resolves wallet rotations at exact log ordering", () => {
    const rows = [
      { blockNumber: 10, logIndex: 2, wallet: "0xa" },
      { blockNumber: 20, logIndex: 4, wallet: null },
      { blockNumber: 20, logIndex: 8, wallet: "0xb" },
    ];
    expect(walletAsOf(rows, { blockNumber: 10, logIndex: 1 })).toBeNull();
    expect(walletAsOf(rows, { blockNumber: 20, logIndex: 3 })).toBe("0xa");
    expect(walletAsOf(rows, { blockNumber: 20, logIndex: 5 })).toBeNull();
    expect(walletAsOf(rows, { blockNumber: 20, logIndex: 8 })).toBe("0xb");
  });
});
