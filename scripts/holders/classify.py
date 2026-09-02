"""Classify holders into plain EOA / EIP-7702-delegated EOA / real contract / AMM pool.

Blockscout's is_contract is true for ANY address carrying code, which includes EOAs that
have set an EIP-7702 delegation (code = 0xef0100 || 20-byte target, exactly 23 bytes).
Those are user wallets, not contracts, so they must not be counted as contracts.

Two passes:
  - EXACT  : every holder above VALUE_CUT USD (these carry essentially all the value,
             and any AMM pool worth excluding is necessarily among them)
  - SAMPLE : a uniform random sample of the rest, for population proportions
"""
import hashlib, json, random, sys
from collections import Counter
from rpc import rpc_batch

VALUE_CUT = 1000.0
SAMPLE_N = 900
SEED = 20260902
SEL_TOKEN0 = "0x0dfe1681"
BATCH = 50


def get_codes(addrs):
    out = {}
    for i in range(0, len(addrs), BATCH):
        chunk = addrs[i:i + BATCH]
        res = rpc_batch([("eth_getCode", [a, "latest"]) for a in chunk])
        for a, r in zip(chunk, res):
            out[a] = r if isinstance(r, str) else None
        print(f"    code {min(i+BATCH, len(addrs))}/{len(addrs)}", file=sys.stderr, flush=True)
    return out


def kind(code):
    if code is None:
        return "unknown"
    if len(code) <= 2:
        return "eoa"
    body = code[2:]
    if len(body) == 46 and body.lower().startswith("ef0100"):
        return "eoa_7702"
    return "contract"


def probe_token0(addrs):
    pools = set()
    for i in range(0, len(addrs), BATCH):
        chunk = addrs[i:i + BATCH]
        res = rpc_batch([("eth_call", [{"to": a, "data": SEL_TOKEN0}, "latest"]) for a in chunk])
        for a, r in zip(chunk, res):
            if isinstance(r, str) and len(r) >= 66:
                pools.add(a)
        print(f"    token0 {min(i+BATCH, len(addrs))}/{len(addrs)} pools={len(pools)}",
              file=sys.stderr, flush=True)
    return pools


def main():
    rows = []
    with open("addr_values.tsv") as f:
        next(f)
        for line in f:
            a, u, np_, nf, c = line.rstrip("\n").split("\t")
            rows.append((a, float(u), int(np_), int(nf), c == "1"))

    rich = [r for r in rows if r[1] > VALUE_CUT]
    rest = [r for r in rows if r[1] <= VALUE_CUT]
    print(f"holders total {len(rows):,} | >${VALUE_CUT:,.0f}: {len(rich):,} | rest {len(rest):,}")

    print(f"EXACT pass over {len(rich):,} high-value holders ...")
    codes = get_codes([r[0] for r in rich])
    kinds = {a: kind(c) for a, c in codes.items()}
    kc = Counter(kinds.values())
    print("  high-value composition:", dict(kc))

    real_contracts = [a for a, k in kinds.items() if k == "contract"]
    print(f"  probing token0() on {len(real_contracts):,} real contracts ...")
    pools = probe_token0(real_contracts)
    print(f"  AMM pools found: {len(pools)}")

    random.seed(SEED)
    samp = random.sample(rest, min(SAMPLE_N, len(rest)))
    print(f"SAMPLE pass over {len(samp):,} of {len(rest):,} remaining holders ...")
    scodes = get_codes([r[0] for r in samp])
    skinds = {a: kind(c) for a, c in scodes.items()}
    sc = Counter(skinds.values())
    n = sum(sc.values())
    print("  sampled composition:", dict(sc))
    for k, v in sc.most_common():
        p = v / n
        se = (p * (1 - p) / n) ** 0.5
        print(f"    {k:10s} {100*p:5.2f}% +/- {100*1.96*se:.2f}pp  -> "
              f"~{round(p*len(rest)):,} of {len(rest):,}")

    # 7702 delegation targets, over both passes
    tg = Counter()
    for src in (codes, scodes):
        for a, c in src.items():
            if c and len(c) == 48 and c[2:].lower().startswith("ef0100"):
                tg["0x" + c[-40:].lower()] += 1
    print("\n  top EIP-7702 delegation targets:")
    for t, v in tg.most_common(6):
        print(f"    {t}  {v}")

    json.dump({"value_cut": VALUE_CUT, "n_rich": len(rich), "n_rest": len(rest),
               "rich_kinds": dict(kc), "rich_kind_map": kinds,
               "pools": sorted(pools),
               "sample_n": n, "sample_kinds": dict(sc),
               "delegation_targets": tg.most_common(20)},
              open("classify.json", "w"), indent=1)
    json.dump(sorted(pools), open("pools.json", "w"), indent=1)
    print("\nwrote classify.json, pools.json")


if __name__ == "__main__":
    main()
