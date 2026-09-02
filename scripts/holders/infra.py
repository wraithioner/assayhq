"""Build the venue-infrastructure address set.

token0() alone is not sufficient on this chain:
  - Uniswap V4 keeps the liquidity of EVERY pool in ONE singleton `PoolManager`, which
    has no token0(); it is the single largest Stock Token holder on the chain.
  - Lighter custodies in a `ZkLighter` proxy.
  - V4 hook contracts answer poolManager() rather than token0().
So the set is: token0() responders  +  poolManager() responders  +  contracts whose
verified name identifies them as a venue.  Protocol vaults/escrows are collected
separately (they pool customer deposits but are not trading venues).
"""
import json
from rpc import rpc_batch

SEL_TOKEN0 = "0x0dfe1681"
SEL_POOLMGR = "0xdc4c90d3"
BATCH = 40

VENUE_NAMES = {"poolmanager", "zklighter", "uniswapv3pool", "uniswapv2pair", "ramsesv3pool",
               "algebrapool", "clpool", "brownfi v3", "ponsv2bondingcurve",
               "rehypedopplerhookinitializer", "v2feeescrow"}
POOL_VAULT_NAMES = {"stockvault", "creditvault", "vault"}

cl = json.load(open("classify.json"))
ident = json.load(open("identify.json"))
pools = set(cl["pools"])                      # token0() responders among >$1k contracts

rows = []
with open("addr_values.tsv") as f:
    next(f)
    for line in f:
        a, u, np_, nf, c = line.rstrip("\n").split("\t")
        rows.append((a, float(u)))
val = dict(rows)

# 1. named venues among the top-400 identification pass
named_venue, named_vault = set(), set()
for a, r in ident.items():
    nm = (r.get("name") or "").strip().lower()
    impl = " ".join([i for i in (r.get("impl") or []) if i]).strip().lower()
    if nm in VENUE_NAMES or impl in VENUE_NAMES:
        named_venue.add(a)
    elif nm in POOL_VAULT_NAMES or impl in POOL_VAULT_NAMES:
        named_vault.add(a)

# 2. V4 hooks: poolManager() responders among high-value real contracts
kinds = cl.get("rich_kind_map", {})
cands = sorted([a for a, k in kinds.items() if k == "contract" and a not in pools],
               key=lambda a: -val.get(a, 0))
hooks = set()
for i in range(0, len(cands), BATCH):
    chunk = cands[i:i + BATCH]
    res = rpc_batch([("eth_call", [{"to": a, "data": SEL_POOLMGR}, "latest"]) for a in chunk])
    for a, r in zip(chunk, res):
        if isinstance(r, str) and len(r) >= 66:
            hooks.add(a)

infra = pools | named_venue | hooks
vaults = named_vault - infra

print(f"token0() AMM pools           : {len(pools):>5}   ${sum(val.get(a,0) for a in pools):>14,.0f}")
print(f"named venues (V4/Lighter/..) : {len(named_venue):>5}   ${sum(val.get(a,0) for a in named_venue):>14,.0f}")
print(f"V4 hooks (poolManager())     : {len(hooks):>5}   ${sum(val.get(a,0) for a in hooks):>14,.0f}")
print(f"UNION venue infrastructure   : {len(infra):>5}   ${sum(val.get(a,0) for a in infra):>14,.0f}")
print(f"protocol vaults (separate)   : {len(vaults):>5}   ${sum(val.get(a,0) for a in vaults):>14,.0f}")

print("\nlargest venue-infrastructure holders:")
for a in sorted(infra, key=lambda a: -val.get(a, 0))[:8]:
    r = ident.get(a, {})
    nm = r.get("name") or "/".join([i for i in (r.get("impl") or []) if i]) or "(token0 pool)"
    print(f"  {a} ${val.get(a,0):>13,.0f}  {nm}")

json.dump({"infra": sorted(infra), "vaults": sorted(vaults),
           "token0_pools": sorted(pools), "named_venue": sorted(named_venue),
           "hooks": sorted(hooks)}, open("infra.json", "w"), indent=1)
print("\nwrote infra.json")
