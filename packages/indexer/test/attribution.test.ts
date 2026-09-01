import { describe, it, expect } from "vitest";
import {
  attributeTransfers,
  classifyAgentCoverage,
  type TransferRef,
  type SwapRef,
} from "../src/attribution.js";

describe("attributeTransfers", () => {
  it("attributes a transfer to a same-token swap in the same tx", () => {
    const transfers: TransferRef[] = [{ key: "0xtx1:2", txHash: "0xtx1", token: "0xaapl", logIndex: 2 }];
    const swaps: SwapRef[] = [{ id: 7, txHash: "0xtx1", stockToken: "0xAAPL", logIndex: 1 }];
    expect(attributeTransfers(transfers, swaps).get("0xtx1:2")).toBe(7);
  });

  it("leaves a transfer unattributed when no swap on that token shares the tx", () => {
    const transfers: TransferRef[] = [
      { key: "a", txHash: "0xtx1", token: "0xaapl", logIndex: 2 }, // no swap in tx
      { key: "b", txHash: "0xtx2", token: "0xnvda", logIndex: 5 }, // swap is a different token
    ];
    const swaps: SwapRef[] = [{ id: 9, txHash: "0xtx2", stockToken: "0xaapl", logIndex: 4 }];
    const res = attributeTransfers(transfers, swaps);
    expect(res.get("a")).toBeNull();
    expect(res.get("b")).toBeNull();
  });

  it("chooses the nearest swap by logIndex when several match", () => {
    const transfers: TransferRef[] = [{ key: "t", txHash: "0xtx", token: "0xaapl", logIndex: 10 }];
    const swaps: SwapRef[] = [
      { id: 1, txHash: "0xtx", stockToken: "0xaapl", logIndex: 3 },
      { id: 2, txHash: "0xtx", stockToken: "0xaapl", logIndex: 9 },
    ];
    expect(attributeTransfers(transfers, swaps).get("t")).toBe(2);
  });
});

describe("classifyAgentCoverage", () => {
  it("scores an agent whose flow is majority feed-covered", () => {
    const r = classifyAgentCoverage([
      { scoreable: true, usdVolume: 700n },
      { scoreable: false, usdVolume: 300n },
    ]);
    expect(r.scoreable).toBe(true);
    expect(r.coverageRatio).toBeCloseTo(0.7, 6);
    expect(r.reason).toBe("ok");
  });

  it("marks an agent unscoreable when the majority of flow is feed-less", () => {
    const r = classifyAgentCoverage([
      { scoreable: true, usdVolume: 200n },
      { scoreable: false, usdVolume: 800n },
    ]);
    expect(r.scoreable).toBe(false);
    expect(r.reason).toBe("majority-feedless");
  });

  it("treats exactly 50% coverage as scoreable (>= half)", () => {
    const r = classifyAgentCoverage([
      { scoreable: true, usdVolume: 500n },
      { scoreable: false, usdVolume: 500n },
    ]);
    expect(r.scoreable).toBe(true);
  });

  it("marks a no-flow agent unscoreable", () => {
    const r = classifyAgentCoverage([]);
    expect(r.scoreable).toBe(false);
    expect(r.reason).toBe("no-flow");
    expect(r.coverageRatio).toBe(0);
  });
});
