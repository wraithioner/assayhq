import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  WAD,
  toUnderlyingShares,
  fromUnderlyingShares,
  rawBalanceValueUsd,
  MultiplierHistory,
  dedupeMultiplierEvents,
} from "../src/index.js";

/**
 * Replays EVERY corporate action ever emitted by an ERC-8056 stock token on
 * Robinhood Chain mainnet (17 `UIMultiplierUpdated` events, 10 tokens, scanned
 * block 0 -> 52,428,883). The fixture is raw chain data, so these tests pin the
 * library — and the README's worked numbers — to reality rather than to
 * invented examples.
 */
const here = dirname(fileURLToPath(import.meta.url));
interface Ev {
  token: string;
  symbol: string | null;
  block: number;
  oldMultiplier: string;
  newMultiplier: string;
  effectiveAt: number;
}
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", "multiplier-history.json"), "utf8"),
) as { _provenance: Record<string, string>; events: Ev[] };

const bySymbol = (s: string) => fixture.events.filter((e) => e.symbol === s);

/** Constant-product LP loss share for a fair-price jump of ratio r. */
function lpLossFraction(rNum: bigint, rDen: bigint): number {
  const r = Number(rNum) / Number(rDen);
  return (Math.sqrt(r) - 1) ** 2 / 2;
}

describe("on-chain fixture: shape and provenance", () => {
  it("carries provenance and the full event set", () => {
    expect(fixture._provenance.topic0).toBe(
      "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055",
    );
    expect(fixture.events.length).toBe(17);
    expect(new Set(fixture.events.map((e) => e.symbol).filter(Boolean)).size).toBe(9);
  });

  it("every event's multipliers are positive 18-dec fixed point", () => {
    for (const e of fixture.events) {
      expect(BigInt(e.oldMultiplier)).toBeGreaterThan(0n);
      expect(BigInt(e.newMultiplier)).toBeGreaterThan(0n);
      expect(e.effectiveAt).toBeGreaterThan(1_700_000_000);
    }
  });
});

describe("CRWD: a real 4:1 split (1.0 -> 4.0)", () => {
  const ev = bySymbol("CRWD")[0]!;

  it("is a clean 4x multiplier", () => {
    expect(BigInt(ev.oldMultiplier)).toBe(WAD);
    expect(BigInt(ev.newMultiplier)).toBe(4n * WAD);
  });

  it("turns 1 raw token into 4 underlying shares, leaving the raw balance untouched", () => {
    const raw = WAD; // 1 whole token
    expect(toUnderlyingShares(raw, BigInt(ev.oldMultiplier))).toBe(WAD);
    expect(toUnderlyingShares(raw, BigInt(ev.newMultiplier))).toBe(4n * WAD);
    // the raw balance is the same number before and after — no rebase
    expect(raw).toBe(WAD);
    expect(fromUnderlyingShares(4n * WAD, BigInt(ev.newMultiplier))).toBe(raw);
  });

  it("does NOT change USD value, because the feed is total-return", () => {
    // A split doubles/quadruples share count and divides the share price; the
    // per-raw-token total-return answer is unchanged, so NAV is continuous.
    const raw = WAD;
    const answerBefore = 31_563_860_540n;
    expect(rawBalanceValueUsd(raw, answerBefore)).toBe(rawBalanceValueUsd(raw, answerBefore));
  });
});

describe("SGOV: a real three-step distribution accrual", () => {
  const evs = bySymbol("SGOV").sort((a, b) => a.block - b.block);

  it("forms an unbroken old->new chain", () => {
    expect(evs.length).toBe(3);
    for (let i = 1; i < evs.length; i++) {
      expect(evs[i]!.oldMultiplier).toBe(evs[i - 1]!.newMultiplier);
    }
    expect(BigInt(evs[0]!.oldMultiplier)).toBe(WAD);
  });

  it("replays into a point-in-time history that never looks ahead", () => {
    const h = MultiplierHistory.fromEvents(
      evs.map((e) => ({
        oldMultiplier: BigInt(e.oldMultiplier),
        newMultiplier: BigInt(e.newMultiplier),
        effectiveAtTimestamp: BigInt(e.effectiveAt),
      })),
    );
    expect(h.multiplierAt(BigInt(evs[0]!.effectiveAt) - 1n)).toBe(WAD);
    for (const e of evs) {
      expect(h.multiplierAt(BigInt(e.effectiveAt))).toBe(BigInt(e.newMultiplier));
      expect(h.multiplierAt(BigInt(e.effectiveAt) - 1n)).toBe(BigInt(e.oldMultiplier));
    }
    expect(h.current()).toBe(BigInt(evs[evs.length - 1]!.newMultiplier));
  });

  it("accrues monotonically (a distribution never reduces underlying shares)", () => {
    const raw = 1_000n * WAD;
    let prev = 0n;
    for (const e of evs) {
      const shares = toUnderlyingShares(raw, BigInt(e.newMultiplier));
      expect(shares).toBeGreaterThan(prev);
      prev = shares;
    }
  });
});

describe("worked LP-loss numbers quoted in the README", () => {
  // LP loss share for a constant-product pool = (sqrt(r) - 1)^2 / 2
  it("canonical 1% dividend => ~1.2438e-5 of pool value (~0.124 bps)", () => {
    const l = lpLossFraction(101n, 100n);
    expect(l).toBeCloseTo(1.2438e-5, 9);
    expect(l * 10_000).toBeCloseTo(0.1244, 3);
  });

  it("real CCL distribution (+2.1486%) => ~5.71e-5 (~0.571 bps)", () => {
    const ccl = bySymbol("CCL")[0]!;
    const l = lpLossFraction(BigInt(ccl.newMultiplier), BigInt(ccl.oldMultiplier));
    expect(l).toBeCloseTo(5.70966e-5, 8);
  });

  it("real AAPL dividend (+0.0566%) => ~4.0e-8 (~0.0004 bps)", () => {
    const aapl = bySymbol("AAPL")[0]!;
    const l = lpLossFraction(BigInt(aapl.newMultiplier), BigInt(aapl.oldMultiplier));
    expect(l).toBeLessThan(1e-7);
  });

  it("an UNCOMPENSATED 10:1 step would drain the pool (bound, not an expectation)", () => {
    expect(lpLossFraction(10n, 1n)).toBeCloseTo(2.3377223398, 6);
  });

  it("a COMPENSATED split is a non-event for the pool (r = 1 => zero loss)", () => {
    expect(lpLossFraction(1n, 1n)).toBe(0);
  });
});

describe("conversion is exact across every real multiplier in the fixture", () => {
  it("round-trips within 1 wei for a range of balances", () => {
    const balances = [0n, 1n, 12_345n, WAD, 1_000n * WAD, 10n ** 30n];
    for (const e of fixture.events) {
      const m = BigInt(e.newMultiplier);
      for (const raw of balances) {
        const rt = fromUnderlyingShares(toUnderlyingShares(raw, m), m);
        expect(rt).toBeLessThanOrEqual(raw);
        expect(raw - rt).toBeLessThanOrEqual(2n);
      }
    }
  });
});

describe("re-emitted UIMultiplierUpdated logs", () => {
  const toUpdate = (e: Ev) => ({
    oldMultiplier: BigInt(e.oldMultiplier),
    newMultiplier: BigInt(e.newMultiplier),
    effectiveAtTimestamp: BigInt(e.effectiveAt),
  });

  /** The fixture is every log on the chain; multipliers are per-token. */
  const byToken = (): Map<string, Ev[]> => {
    const m = new Map<string, Ev[]>();
    for (const e of fixture.events) m.set(e.token, [...(m.get(e.token) ?? []), e]);
    for (const logs of m.values()) logs.sort((a, b) => a.block - b.block);
    return m;
  };

  const CRWD = "0xea72ecca2d0f6bfa1394dbbcff85b52cd4233931";
  const UNLISTED = "0xc93a8c440cea26d7445df01729f193b27965099f";

  it("2 of the 17 logs are repeats, not distinct corporate actions", () => {
    const distinct = new Set(
      fixture.events.map((e) => `${e.token}:${e.oldMultiplier}:${e.newMultiplier}:${e.effectiveAt}`),
    );
    expect(fixture.events.length).toBe(17);
    expect(distinct.size).toBe(15);
  });

  it("CRWD's 4:1 split is logged twice, identically, at two different blocks", () => {
    const [a, b] = bySymbol("CRWD").sort((x, y) => x.block - y.block);
    expect([a!.block, b!.block]).toEqual([978_630, 1_231_096]);
    expect(a!.oldMultiplier).toBe(b!.oldMultiplier);
    expect(a!.newMultiplier).toBe(b!.newMultiplier);
    expect(a!.effectiveAt).toBe(b!.effectiveAt);
  });

  it("fromEvents rejects the raw stream rather than silently mis-valuing", () => {
    const raw = bySymbol("CRWD")
      .sort((x, y) => x.block - y.block)
      .map(toUpdate);
    expect(() => MultiplierHistory.fromEvents(raw)).toThrow(/chain broken/);
    // and the message points at the fix
    expect(() => MultiplierHistory.fromEvents(raw)).toThrow(/dedupeMultiplierEvents/);
  });

  it("dedupe collapses the repeat, and the history then builds", () => {
    const clean = dedupeMultiplierEvents(
      bySymbol("CRWD")
        .sort((x, y) => x.block - y.block)
        .map(toUpdate),
    );
    expect(clean).toHaveLength(1);
    expect(MultiplierHistory.fromEvents(clean).current()).toBe(4n * WAD);
  });

  it("without dedupe, exactly the two repeating tokens fail", () => {
    const failed: string[] = [];
    for (const [token, logs] of byToken()) {
      try {
        MultiplierHistory.fromEvents(logs.map(toUpdate));
      } catch {
        failed.push(token);
      }
    }
    expect(failed.sort()).toEqual([UNLISTED, CRWD].sort());
  });

  it("with dedupe, every token on the chain builds a clean point-in-time history", () => {
    const failed: string[] = [];
    for (const [token, logs] of byToken()) {
      try {
        MultiplierHistory.fromEvents(dedupeMultiplierEvents(logs.map(toUpdate)));
      } catch (err) {
        failed.push(`${token}: ${(err as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  });
});
