"""Name the top holders via Blockscout so venue infrastructure can be excluded properly.

token0() only finds Uniswap-V2/V3-style pools, where each pool is its own contract. It
cannot find:
  - Uniswap V4, whose liquidity for EVERY pool sits in one singleton `PoolManager`;
  - order-book venues such as Lighter (`ZkLighter`), which custody in one proxy.
Both hold large balances and are not customers, so they are identified by verified
contract name instead.
"""
import json, queue, sys, threading, time, urllib.request, urllib.error

BS = "https://robinhoodchain.blockscout.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
TOPN = 400
WORKERS = 8


def get(url, tries=6):
    delay = 1.0
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {}
            if i == tries - 1:
                return {}
            time.sleep(delay); delay = min(delay * 2, 30)
        except Exception:
            if i == tries - 1:
                return {}
            time.sleep(delay); delay = min(delay * 2, 30)
    return {}


rows = []
with open("addr_values.tsv") as f:
    next(f)
    for line in f:
        a, u, np_, nf, c = line.rstrip("\n").split("\t")
        rows.append((a, float(u), int(np_) + int(nf)))
rows.sort(key=lambda r: -r[1])
top = rows[:TOPN]

q = queue.Queue()
for r in top:
    q.put(r)
res = {}
lock = threading.Lock()


def w():
    while True:
        try:
            a, u, nt = q.get_nowait()
        except queue.Empty:
            return
        d = get(f"{BS}/api/v2/addresses/{a}")
        res[a] = {
            "usd": u, "tokens": nt,
            "name": d.get("name"),
            "is_contract": d.get("is_contract"),
            "is_verified": d.get("is_verified"),
            "impl": [i.get("name") for i in (d.get("implementations") or [])],
        }
        with lock:
            if len(res) % 50 == 0:
                print(f"  .. {len(res)}/{len(top)}", file=sys.stderr, flush=True)


ts = [threading.Thread(target=w, daemon=True) for _ in range(WORKERS)]
for t in ts:
    t.start()
for t in ts:
    t.join()

json.dump(res, open("identify.json", "w"), indent=1)

print(f"named top {len(res)} holders by value\n")
print(f"{'address':44s} {'usd':>14s} {'tok':>4s}  name / implementation")
for a, u, nt in top[:45]:
    r = res.get(a, {})
    nm = r.get("name") or ("EOA" if r.get("is_contract") is False else "?unverified")
    impl = "/".join([i for i in (r.get("impl") or []) if i])
    print(f"{a:44s} ${u:>13,.0f} {nt:>4}  {nm}{(' -> ' + impl) if impl else ''}")

from collections import Counter
c = Counter((r.get("name") or ("EOA" if r.get("is_contract") is False else "?unverified"))
            for r in res.values())
print("\nname frequency in the top", len(res))
for k, v in c.most_common(20):
    tot = sum(r["usd"] for r in res.values()
              if (r.get("name") or ("EOA" if r.get("is_contract") is False else "?unverified")) == k)
    print(f"  {k:34s} n={v:>4}  ${tot:>14,.0f}")
