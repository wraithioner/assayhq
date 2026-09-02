import csv, json
from rpc import rpc, call

head = int(rpc("eth_blockNumber", []), 16)
print("head block:", f"{head:,}")

feeds = [f for f in csv.DictReader(open("chainlink-feeds.csv")) if f["kind"] == "rh_total_return"]
out = {}
for f in feeds:
    r = call(f["proxyAddress"], "0xfeaf968c")           # latestRoundData()
    if not r or len(r) < 2 + 64 * 5:
        print("  FAIL", f["ticker"], r); continue
    w = r[2:]
    answer = int(w[64:128], 16)
    if answer >= 2**255: answer -= 2**256
    updated = int(w[192:256], 16)
    out[f["ticker"]] = {"proxy": f["proxyAddress"], "answer": answer,
                        "decimals": int(f["decimals"]), "updatedAt": updated,
                        "usd": answer / 10 ** int(f["decimals"])}

json.dump({"head_block": head, "feeds": out}, open("prices.json", "w"), indent=1)
print(f"priced {len(out)}/{len(feeds)} feeds")
for k in sorted(out)[:8]:
    print(f"  {k:6s} ${out[k]['usd']:>10,.4f}")
