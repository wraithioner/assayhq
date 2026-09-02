import { describe, it, expect } from "vitest";
import {
  attributeTransfers,
  classifyAgentCoverage,
  type TransferRef,
  type SwapRef,
} from "../src/attribution.js";

const transfer = (overrides: Partial<TransferRef> = {}): TransferRef => ({
  key: "0xtx:2",
  txHash: "0xtx",
  token: "0xaapl",
  logIndex: 2,
  fromAddr: "0xpool",
  toAddr: "0xagent",
  rawValue: 100n,
  ...overrides,
});

const swap = (overrides: Partial<SwapRef> = {}): SwapRef => ({
  id: 7,
  txHash: "0xtx",
  stockToken: "0xaapl",
  logIndex: 1,
  pool: "0xpool",
  stockAmount: -100n,
  ...overrides,
});

describe("attributeTransfers", () => {
  it("uses the pool counterparty and exact amount when available", () => {
    expect(attributeTransfers([transfer()], [swap()]).get("0xtx:2")).toEqual({
      swapId: 7,
      status: "matched",
      method: "pool-counterparty",
    });
  });

  it("leaves a transfer unattributed when no swap on that token shares the tx", () => {
    const transfers: TransferRef[] = [
      transfer({ key: "a", txHash: "0xtx1" }),
      transfer({ key: "b", txHash: "0xtx2", token: "0xnvda" }),
    ];
    const swaps: SwapRef[] = [swap({ id: 9, txHash: "0xtx2" })];
    const res = attributeTransfers(transfers, swaps);
    expect(res.get("a")?.status).toBe("unattributed");
    expect(res.get("b")?.status).toBe("unattributed");
  });

  it("uses a unique amount match when router hops obscure the pool counterparty", () => {
    const swaps: SwapRef[] = [
      swap({ id: 1, pool: "0xpool1", stockAmount: -90n }),
      swap({ id: 2, pool: "0xpool2", stockAmount: -100n }),
    ];
    expect(
      attributeTransfers([transfer({ fromAddr: "0xrouter" })], swaps).get("0xtx:2"),
    ).toEqual({ swapId: 2, status: "matched", method: "exact-amount" });
  });

  it("refuses to guess between multiple indistinguishable swaps", () => {
    const swaps: SwapRef[] = [
      swap({ id: 1, pool: "0xpool1" }),
      swap({ id: 2, pool: "0xpool2" }),
    ];
    expect(
      attributeTransfers([transfer({ fromAddr: "0xrouter" })], swaps).get("0xtx:2"),
    ).toEqual({ swapId: null, status: "ambiguous", method: null });
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

  it("does not silently omit flow that cannot be priced", () => {
    const r = classifyAgentCoverage([
      { scoreable: true, usdVolume: 1_000n },
      { scoreable: false, usdVolume: null },
    ]);
    expect(r.scoreable).toBe(false);
    expect(r.unknownItems).toBe(1);
    expect(r.reason).toBe("unknown-unpriced-flow");
  });
});
