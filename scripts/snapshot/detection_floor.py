#!/usr/bin/env python3
"""
How active must an address be before the sampled detector can see it?

`subsidy_snapshot.py` and docs/MARKET_SIZE.md find "sustained automated addresses" by
sampling AGENT_WINDOWS windows of AGENT_WINDOW_SPAN blocks each, spread over
AGENT_LOOKBACK blocks, and keeping addresses seen in at least SUSTAINED_MIN_WINDOWS of
them. That observes a tiny fraction of the period, so the method has a hard sensitivity
floor: below some trading frequency an address is effectively invisible.

This script computes that floor from the same constants, so the published counts can be
read as "addresses trading at least ~N times/day" rather than "all automated addresses".

Model: an address making `n` trades per day, spread uniformly, is active in a given
window with probability p = min(1, n * window_seconds / 86400). Detection requires
appearing in >= SUSTAINED_MIN_WINDOWS of AGENT_WINDOWS independent windows, so the
detection probability is the binomial upper tail.

Uniformity is the optimistic assumption. Real automated flow is bursty — the median
inter-event coefficient of variation measured on this chain was 2.14 — and bursty
activity of the same daily volume is HARDER to catch, because the events cluster into
fewer intervals. So these thresholds are a best case; the true floor is higher.

    python3 scripts/snapshot/detection_floor.py
"""
from math import comb

# Must mirror subsidy_snapshot.py exactly.
AGENT_WINDOWS = 16
AGENT_WINDOW_SPAN = 400
SUSTAINED_MIN_WINDOWS = 3
AGENT_LOOKBACK = 40_000_000
BLOCK_MS = 100

WINDOW_SECONDS = AGENT_WINDOW_SPAN * BLOCK_MS / 1000
PERIOD_SECONDS = AGENT_LOOKBACK * BLOCK_MS / 1000


def p_detect(trades_per_day: float) -> float:
    p = min(1.0, trades_per_day * WINDOW_SECONDS / 86_400)
    return sum(comb(AGENT_WINDOWS, k) * p**k * (1 - p) ** (AGENT_WINDOWS - k)
               for k in range(SUSTAINED_MIN_WINDOWS, AGENT_WINDOWS + 1))


def threshold(target: float) -> float:
    lo, hi = 1e-6, 1e7
    for _ in range(200):
        mid = (lo + hi) / 2
        if p_detect(mid) < target:
            lo = mid
        else:
            hi = mid
    return lo


if __name__ == "__main__":
    observed = AGENT_WINDOWS * WINDOW_SECONDS
    print(f"{AGENT_WINDOWS} windows x {WINDOW_SECONDS:.0f}s, over {PERIOD_SECONDS/86400:.0f} days")
    print(f"observed {observed:.0f}s of {PERIOD_SECONDS:,.0f}s = "
          f"{100*observed/PERIOD_SECONDS:.4f}% of the period")
    print(f"detection rule: seen in >= {SUSTAINED_MIN_WINDOWS} of {AGENT_WINDOWS} windows\n")
    print(f"{'trades/day':>12} {'P(detected)':>13}")
    for n in (1, 10, 50, 100, 250, 500, 750, 1_000, 2_000, 10_000):
        print(f"{n:>12,} {100*p_detect(n):>12.2f}%")
    print()
    for t in (0.05, 0.50, 0.95):
        print(f"  {int(t*100):>2}% detection at ~{threshold(t):,.0f} trades/day")
    print("\nUniform arrivals assumed — bursty activity of the same daily volume is harder\n"
          "to catch, so treat these as a best case.")
