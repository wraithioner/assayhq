/**
 * Point-in-time UI-multiplier history.
 *
 * Built from `UIMultiplierUpdated(oldMultiplier, newMultiplier, effectiveAtTimestamp)`
 * events. A multiplier becomes effective at `effectiveAtTimestamp` (which may be
 * scheduled *after* the block that emitted the event — see the pending
 * `newUIMultiplier()`/`effectiveAt()` getters). `multiplierAt(t)` returns the
 * multiplier in effect at time `t` and, by construction, never consults an
 * update whose effective time is after `t` (no lookahead).
 */
import { WAD } from "./constants.js";

export interface UIMultiplierUpdate {
  /** New multiplier (18-dec fixed point). */
  newMultiplier: bigint;
  /** Unix seconds at which it becomes effective. */
  effectiveAt: bigint;
  /** Previous multiplier, if decoded from the event (used for a consistency check). */
  oldMultiplier?: bigint;
}

interface Point {
  effectiveAt: bigint;
  multiplier: bigint;
}

export class MultiplierHistory {
  /** Sorted ascending by effectiveAt; index 0 is the genesis point. */
  private readonly points: readonly Point[];

  /**
   * @param initialMultiplier multiplier in effect from the beginning (launch = WAD).
   * @param updates           UIMultiplierUpdated records, any order.
   */
  constructor(initialMultiplier: bigint = WAD, updates: readonly UIMultiplierUpdate[] = []) {
    if (initialMultiplier <= 0n) {
      throw new RangeError(`initialMultiplier must be > 0, got ${initialMultiplier}`);
    }
    const sorted = [...updates].sort((a, b) =>
      a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : 0,
    );
    const points: Point[] = [{ effectiveAt: -1n << 62n, multiplier: initialMultiplier }];
    for (const u of sorted) {
      if (u.newMultiplier <= 0n) {
        throw new RangeError(`newMultiplier must be > 0, got ${u.newMultiplier}`);
      }
      const prev = points[points.length - 1]!;
      // Consistency check: the event's oldMultiplier should match the running value.
      if (u.oldMultiplier !== undefined && u.oldMultiplier !== prev.multiplier) {
        throw new Error(
          `UIMultiplierUpdated chain broken at effectiveAt=${u.effectiveAt}: ` +
            `oldMultiplier=${u.oldMultiplier} but running multiplier=${prev.multiplier}. ` +
            `If these are raw logs, Robinhood Chain re-emits some updates — ` +
            `run them through dedupeMultiplierEvents() first.`,
        );
      }
      // Defence in depth: unreachable while the constructor sorts by effectiveAt
      // above, but kept so the invariant fails loudly if that sort is ever removed.
      /* v8 ignore next 3 */
      if (u.effectiveAt < prev.effectiveAt) {
        throw new Error(`updates not monotonic in effectiveAt near ${u.effectiveAt}`);
      }
      // A later update at the same effectiveAt replaces the earlier one.
      if (u.effectiveAt === prev.effectiveAt && points.length > 1) {
        points[points.length - 1] = { effectiveAt: u.effectiveAt, multiplier: u.newMultiplier };
      } else {
        points.push({ effectiveAt: u.effectiveAt, multiplier: u.newMultiplier });
      }
    }
    this.points = points;
  }

  /** Build from raw decoded UIMultiplierUpdated events (validates the old->new chain). */
  static fromEvents(
    events: readonly { oldMultiplier: bigint; newMultiplier: bigint; effectiveAtTimestamp: bigint }[],
    initialMultiplier: bigint = WAD,
  ): MultiplierHistory {
    const updates = events.map((e) => ({
      newMultiplier: e.newMultiplier,
      effectiveAt: e.effectiveAtTimestamp,
      oldMultiplier: e.oldMultiplier,
    }));
    return new MultiplierHistory(initialMultiplier, updates);
  }

  /** The multiplier in effect at unix time `timestamp`. Point-in-time: never looks ahead. */
  multiplierAt(timestamp: bigint): bigint {
    const pts = this.points;
    // Binary search for the last point with effectiveAt <= timestamp.
    let lo = 0;
    let hi = pts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid]!.effectiveAt <= timestamp) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return pts[ans]!.multiplier;
  }

  /** The most recent (current) multiplier. */
  current(): bigint {
    return this.points[this.points.length - 1]!.multiplier;
  }

  /** Distinct effective-multiplier changes, excluding the synthetic genesis point. */
  changes(): { effectiveAt: bigint; multiplier: bigint }[] {
    return this.points.slice(1).map((p) => ({ effectiveAt: p.effectiveAt, multiplier: p.multiplier }));
  }
}

/** The fields of a decoded `UIMultiplierUpdated` log that identify its content. */
export interface RawMultiplierEvent {
  oldMultiplier: bigint;
  newMultiplier: bigint;
  effectiveAtTimestamp: bigint;
}

/**
 * Drop re-emitted `UIMultiplierUpdated` logs from one token's log stream.
 *
 * Robinhood Chain does not emit exactly one log per corporate action. CRWD's
 * 4:1 split is logged at blocks 978,630 *and* 1,231,096 with identical
 * `oldMultiplier`, `newMultiplier` and `effectiveAt`. Fed straight to
 * {@link MultiplierHistory.fromEvents}, the repeat fails the old->new chain
 * check: the running multiplier is already 4.0 when a log claiming
 * `oldMultiplier = 1.0` arrives.
 *
 * A log counts as a repeat only when **all three** fields match one already
 * seen, so two genuinely different actions can never be merged — including a
 * corrected schedule that reuses an `effectiveAt` with a different
 * `newMultiplier`, which `MultiplierHistory` resolves on its own.
 *
 * Input order is preserved and the first occurrence of each triple is kept.
 * Extra fields (block, tx hash) are carried through untouched.
 *
 * Pass **one token's** logs at a time — multipliers are per-token, so mixing
 * tokens would compare unrelated chains.
 *
 * ```ts
 * MultiplierHistory.fromEvents(dedupeMultiplierEvents(logsForOneToken));
 * ```
 */
export function dedupeMultiplierEvents<T extends RawMultiplierEvent>(events: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of events) {
    const key = `${e.oldMultiplier}:${e.newMultiplier}:${e.effectiveAtTimestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
