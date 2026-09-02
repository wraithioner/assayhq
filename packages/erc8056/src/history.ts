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
            `oldMultiplier=${u.oldMultiplier} but running multiplier=${prev.multiplier}`,
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
