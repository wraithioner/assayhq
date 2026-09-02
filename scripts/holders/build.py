"""Merge complete token files and value-ordered prefixes into per-address USD positions.

Blockscout's /api/v2 holders list is strictly value-DESCENDING (verified on every
completed file). So for a token we only fetched partially, the rows we have are exactly
the top-K holders by balance, and every holder we did NOT fetch holds strictly less than
the smallest balance we did fetch. That gives a hard upper bound on the missing value:

    missing_usd(token) <= (declared_holders - fetched) * smallest_fetched_balance * price

Pricing (docs/RECON.md D-0.6): feeds are total-return and already multiplier-adjusted,
so usd = raw/1e18 * answer/1e8 and the ERC-8056 multiplier is NOT reapplied.
"""
import glob, json, os, sys
from collections import defaultdict

meta = {m["address"].lower(): m for m in json.load(open("token_meta.json")) if m["holders_count"]}
prices = json.load(open("prices.json"))
feed = {k: v["usd"] for k, v in prices["feeds"].items()}
sym_by_addr = {a: m["symbol"] for a, m in meta.items()}

usd = defaultdict(float)
n_priced = defaultdict(int)
n_feedless = defaultdict(int)
is_contract = {}
tok_usd = defaultdict(float)
coverage = []          # per-token completeness record


def ingest(rows, tok_addr):
    sym = sym_by_addr.get(tok_addr, "?")
    px = feed.get(sym)
    n = 0
    for a, v, c in rows:
        val = int(v)
        if val == 0:
            continue
        n += 1
        if c == "1":
            is_contract[a] = "1"
        elif a not in is_contract:
            is_contract[a] = "0"
        whole = val / 1e18
        if px is not None:
            d = whole * px
            usd[a] += d
            tok_usd[sym] += d
            n_priced[a] += 1
        else:
            n_feedless[a] += 1
    return n, sym, px


seen_tokens = set()

# 1. fully enumerated tokens
for f in sorted(glob.glob("rawv2/*.tsv.done")):
    t = f[:-5]
    tok_addr = os.path.basename(t).rsplit("_", 1)[1][:-4].lower()
    rows = [tuple(l.rstrip("\n").split("\t")) for l in open(t)]
    rows = [r for r in rows if len(r) == 3]
    n, sym, px = ingest(rows, tok_addr)
    seen_tokens.add(tok_addr)
    coverage.append({"symbol": sym, "address": tok_addr, "declared": meta[tok_addr]["holders_count"],
                     "fetched": len(rows), "complete": True, "priced": px is not None,
                     "max_missing_usd": 0.0})

# 2. partially enumerated tokens (value-ordered prefix from the live checkpoint)
for f in sorted(glob.glob("rawv2/*.tsv.ckpt")):
    tok_addr = os.path.basename(f).rsplit("_", 1)[1][:-9].lower()
    if tok_addr in seen_tokens:
        continue
    try:
        st = json.load(open(f))
    except Exception as e:          # checkpoint being rewritten concurrently
        print(f"  skip in-flight checkpoint {os.path.basename(f)}: {e}", file=sys.stderr)
        continue
    rows = [tuple(r) for r in st["rows"]]
    n, sym, px = ingest(rows, tok_addr)
    seen_tokens.add(tok_addr)
    declared = meta[tok_addr]["holders_count"]
    smallest = int(rows[-1][1]) / 1e18 if rows else 0.0
    miss = max(0, declared - len(rows))
    coverage.append({"symbol": sym, "address": tok_addr, "declared": declared,
                     "fetched": len(rows), "complete": False, "priced": px is not None,
                     "smallest_fetched_tokens": smallest,
                     "missing_holders": miss,
                     "max_missing_usd": (miss * smallest * px) if px else 0.0})

# 3. tokens with no data at all
for a, m in meta.items():
    if a not in seen_tokens:
        coverage.append({"symbol": m["symbol"], "address": a, "declared": m["holders_count"],
                         "fetched": 0, "complete": False, "priced": m["symbol"] in feed,
                         "smallest_fetched_tokens": None, "missing_holders": m["holders_count"],
                         "max_missing_usd": None})

addrs = set(usd) | set(n_feedless)
with open("addr_values.tsv", "w") as out:
    out.write("address\tusd\tn_priced\tn_feedless\tis_contract\n")
    for a in addrs:
        out.write(f"{a}\t{usd.get(a, 0.0):.10f}\t{n_priced.get(a, 0)}\t"
                  f"{n_feedless.get(a, 0)}\t{is_contract.get(a, '0')}\n")

complete = [c for c in coverage if c["complete"]]
partial = [c for c in coverage if not c["complete"]]
pos_have = sum(c["fetched"] for c in coverage)
pos_declared = sum(c["declared"] for c in coverage)
bound = sum(c["max_missing_usd"] for c in partial if c["max_missing_usd"] is not None)
unbounded = [c["symbol"] for c in partial if c["max_missing_usd"] is None and c["priced"]]

total = sum(usd.values())
print(f"tokens fully enumerated : {len(complete)}/{len(coverage)}")
print(f"tokens partial (prefix) : {len(partial)}  {[c['symbol'] for c in partial]}")
print(f"holder positions loaded : {pos_have:,} of {pos_declared:,} declared "
      f"({100*pos_have/pos_declared:.1f}%)")
print(f"distinct addresses      : {len(addrs):,}   (LOWER BOUND)")
print(f"contracts among them    : {sum(1 for a in addrs if is_contract.get(a)=='1'):,}")
print(f"TOTAL priced USD seen   : ${total:,.0f}")
print(f"max value missed (bound): ${bound:,.0f}  ({100*bound/max(1,total):.2f}% of seen)")
if unbounded:
    print(f"UNBOUNDED (no prefix)   : {unbounded}")

json.dump({"coverage": coverage, "positions_loaded": pos_have, "positions_declared": pos_declared,
           "distinct": len(addrs), "total_usd": total, "max_missing_usd": bound,
           "tok_usd": dict(sorted(tok_usd.items(), key=lambda x: -x[1]))},
          open("build_summary.json", "w"), indent=1)
print("wrote addr_values.tsv, build_summary.json")
