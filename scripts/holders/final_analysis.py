"""Final distribution / concentration report over addr_values.tsv + classify.json."""
import json, statistics
from collections import Counter

BUCKETS = [0, 100, 1_000, 10_000, 100_000, 1_000_000]

rows = []
with open("addr_values.tsv") as f:
    next(f)
    for line in f:
        a, u, np_, nf, c = line.rstrip("\n").split("\t")
        rows.append((a, float(u), int(np_), int(nf)))

cl = json.load(open("classify.json"))
inf = json.load(open("infra.json"))
pools = set(inf["infra"])
build = json.load(open("build_summary.json"))

infra = [r for r in rows if r[0] in pools]
cust = [r for r in rows if r[0] not in pools]


def stats(name, rs):
    vals = [r[1] for r in rs]
    nz = [v for v in vals if v > 0]
    tot = sum(vals)
    s = sorted(vals, reverse=True)
    n = len(s)

    def share(k):
        k = max(1, min(k, n))
        return sum(s[:k]) / tot if tot else 0

    print(f"\n=== {name} ===")
    print(f"  addresses                 : {n:,}")
    print(f"  with priced value > $0    : {len(nz):,}")
    print(f"  total priced value        : ${tot:,.0f}")
    print(f"  mean   (all)              : ${tot/max(1,n):,.2f}")
    print(f"  median (all)              : ${statistics.median(vals) if vals else 0:,.4f}")
    if nz:
        print(f"  mean   (value > $0)       : ${statistics.mean(nz):,.2f}")
        print(f"  median (value > $0)       : ${statistics.median(nz):,.4f}")
    print("  cumulative histogram:")
    prev = n
    for b in BUCKETS:
        c = sum(1 for v in vals if v > b)
        print(f"    > ${b:>9,} : {c:>8,}  ({100*c/max(1,n):6.3f}%)")
    print("  bucket counts:")
    edges = BUCKETS + [float("inf")]
    for lo, hi in zip(edges, edges[1:]):
        c = sum(1 for v in vals if lo < v <= hi)
        hs = "inf" if hi == float("inf") else f"${hi:,.0f}"
        print(f"    ${lo:>9,.0f} - {hs:>12} : {c:>8,}")
    if tot:
        print("  share of total value held by:")
        print(f"    top 1 wallet              : {100*share(1):6.2f}%")
        print(f"    top 10 wallets            : {100*share(10):6.2f}%")
        print(f"    top 100 wallets           : {100*share(100):6.2f}%")
        print(f"    top 1%   (n={max(1,round(n*0.01)):>7,})     : {100*share(round(n*0.01)):6.2f}%")
        print(f"    top 10%  (n={max(1,round(n*0.10)):>7,})     : {100*share(round(n*0.10)):6.2f}%")
    return {"n": n, "n_gt0": len(nz), "total": tot,
            "mean_all": tot/max(1,n), "median_all": statistics.median(vals) if vals else 0,
            "mean_nz": statistics.mean(nz) if nz else 0,
            "median_nz": statistics.median(nz) if nz else 0,
            "cum": {b: sum(1 for v in vals if v > b) for b in BUCKETS},
            "top1": share(1), "top10": share(10), "top100": share(100),
            "top1pct": share(round(n*0.01)), "top10pct": share(round(n*0.10))}


out = {}
out["all"] = stats("ALL enumerated holders (incl. venue infrastructure)", rows)
out["infra"] = stats("VENUE INFRASTRUCTURE (AMM pools + Uniswap V4 PoolManager + Lighter + V4 hooks)", infra)
out["customers"] = stats("HOLDERS EXCLUDING VENUE INFRASTRUCTURE", cust)

print("\n=== FEED-LESS EXPOSURE (token counts, not value) ===")
anyfl = sum(1 for r in cust if r[3] > 0)
onlyfl = sum(1 for r in cust if r[2] == 0 and r[3] > 0)
print(f"  hold >=1 feed-less token           : {anyfl:,}")
print(f"  hold ONLY feed-less tokens (USD=0) : {onlyfl:,}")
print(f"  feed-less positions                : {sum(r[3] for r in cust):,}")
print(f"  priced positions                   : {sum(r[2] for r in cust):,}")
out["feedless"] = {"any": anyfl, "only": onlyfl,
                   "positions_feedless": sum(r[3] for r in cust),
                   "positions_priced": sum(r[2] for r in cust)}

print("\n=== TOKENS PER HOLDER (non-infrastructure) ===")
tc = Counter(r[2] + r[3] for r in cust)
for k in sorted(tc)[:10]:
    print(f"  {k:>3} token(s): {tc[k]:>8,}  ({100*tc[k]/len(cust):5.2f}%)")
print(f"  mean tokens/holder: {sum(r[2]+r[3] for r in cust)/len(cust):.2f}")

print("\n=== TOP 20 NON-INFRASTRUCTURE HOLDERS ===")
kinds = cl.get("rich_kind_map", {})
for a, u, np_, nf in sorted(cust, key=lambda r: -r[1])[:20]:
    print(f"  {a} ${u:>13,.0f}  tokens={np_+nf:<3} {kinds.get(a,'?')}")

print("\n=== TOP 10 VENUE-INFRASTRUCTURE HOLDERS ===")
for a, u, np_, nf in sorted(infra, key=lambda r: -r[1])[:10]:
    print(f"  {a} ${u:>13,.0f}  tokens={np_+nf}")

out["coverage"] = {"positions_loaded": build["positions_loaded"],
                   "positions_declared": build["positions_declared"],
                   "max_missing_usd": build["max_missing_usd"],
                   "partial_tokens": [c["symbol"] for c in build["coverage"] if not c["complete"]]}
json.dump(out, open("final_analysis.json", "w"), indent=1, default=float)
print("\nwrote final_analysis.json")
