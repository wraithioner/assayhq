"""First Stock Token acquisition per address -> weekly cohorts (Q6) and funder clustering (Q7).

Method: Blockscout /api/v2/addresses/{a}/token-transfers is newest-first with cursor
pagination. For each sampled address we page back up to MAXPAGES, keep only transfers of
Stock Token contracts where the address is the RECIPIENT, and take the oldest such
transfer. If the history is not exhausted within MAXPAGES the observation is marked
CENSORED: the true first acquisition is at or before the oldest transfer we saw.

Two populations are sampled:
  - growth   : a uniform random sample of non-infrastructure holders  -> weekly cohorts
  - funders  : every non-infrastructure holder above $1,000 (capped)  -> first-funder clustering
"""
import csv, json, os, queue, random, sys, threading, time
import urllib.parse, urllib.request, urllib.error
from collections import Counter, defaultdict

BS = "https://robinhoodchain.blockscout.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
WORKERS = 8
MAXPAGES = 8
SEED = 20260902

STOCK = {t["address"].lower() for t in csv.DictReader(open("stock-tokens.csv"))}
lock = threading.Lock()
prog = {"n": 0}


def get(url, tries=8):
    delay = 1.0
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.loads(r.read().decode())
            if not isinstance(d, dict) or not isinstance(d.get("items"), list):
                raise ValueError("soft limit")
            return d
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"items": [], "next_page_params": None}
            if i == tries - 1:
                raise
            time.sleep(delay * (3 if e.code == 429 else 1))
            delay = min(delay * 1.8, 45)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.8, 45)


def first_acq(addr):
    """-> dict(ts, block, frm, token, censored) or None if no inbound stock-token transfer seen."""
    base = f"{BS}/api/v2/addresses/{addr}/token-transfers?type=ERC-20"
    url, pages, best, exhausted = base, 0, None, False
    while pages < MAXPAGES:
        d = get(url)
        for it in d["items"]:
            tok = ((it.get("token") or {}).get("address_hash")
                   or (it.get("token") or {}).get("address") or "").lower()
            to = ((it.get("to") or {}).get("hash") or "").lower()
            if tok in STOCK and to == addr:
                best = {"ts": it.get("timestamp"),
                        "block": it.get("block_number"),
                        "frm": ((it.get("from") or {}).get("hash") or "").lower(),
                        "token": tok}
        pages += 1
        nxt = d.get("next_page_params")
        if not nxt:
            exhausted = True
            break
        url = base + "&" + urllib.parse.urlencode(nxt)
    if best:
        best["censored"] = not exhausted
    return best


def run(addrs, outfile):
    q = queue.Queue()
    for a in addrs:
        q.put(a)
    res = {}

    def w():
        while True:
            try:
                a = q.get_nowait()
            except queue.Empty:
                return
            try:
                res[a] = first_acq(a)
            except Exception as e:
                res[a] = {"error": str(e)[:60]}
            with lock:
                prog["n"] += 1
                if prog["n"] % 50 == 0:
                    print(f"  .. {prog['n']}/{len(addrs)}", file=sys.stderr, flush=True)

    ts = [threading.Thread(target=w, daemon=True) for _ in range(WORKERS)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    json.dump(res, open(outfile, "w"), indent=1)
    return res


def main():
    pools = set(json.load(open("pools.json")))
    rows = []
    with open("addr_values.tsv") as f:
        next(f)
        for line in f:
            a, u, np_, nf, c = line.rstrip("\n").split("\t")
            if a not in pools:
                rows.append((a, float(u)))

    random.seed(SEED)
    mode = sys.argv[1] if len(sys.argv) > 1 else "growth"

    if mode == "growth":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 500
        sample = random.sample([r[0] for r in rows], min(n, len(rows)))
        print(f"growth sample: {len(sample)} of {len(rows):,} non-infra holders", flush=True)
        prog["n"] = 0
        res = run(sample, "cohorts_growth.json")
        wk = Counter()
        cens = 0
        for a, r in res.items():
            if not r or "ts" not in r or not r["ts"]:
                continue
            if r.get("censored"):
                cens += 1
            wk[r["ts"][:10]] = wk[r["ts"][:10]]
        # weekly buckets
        import datetime
        wc = Counter()
        for a, r in res.items():
            if not r or not r.get("ts"):
                continue
            d = datetime.date.fromisoformat(r["ts"][:10])
            wc[(d - datetime.timedelta(days=d.weekday())).isoformat()] += 1
        print(f"\nresolved: {sum(wc.values())}/{len(sample)} | censored: {cens}")
        print("first-acquisition week (Monday) -> sampled holders:")
        for k in sorted(wc):
            print(f"  {k}: {wc[k]:>4}  ({100*wc[k]/max(1,sum(wc.values())):5.1f}%)")

    else:
        cap = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
        rich = [a for a, u in rows if u > 1000]
        random.shuffle(rich)
        sample = rich[:cap]
        print(f">$1k wallets: {len(rich):,} | probing {len(sample):,}", flush=True)
        prog["n"] = 0
        res = run(sample, "cohorts_funders.json")
        f = Counter()
        for a, r in res.items():
            if r and r.get("frm"):
                f[r["frm"]] += 1
        tot = sum(f.values())
        print(f"\nresolved first-funder for {tot}/{len(sample)}")
        print("top first-funders of >$1k wallets:")
        for addr, c in f.most_common(15):
            print(f"  {addr}  {c:>5}  ({100*c/max(1,tot):5.1f}%)")
        print(f"distinct funders: {len(f):,}")
        json.dump({"funders": f.most_common(200), "resolved": tot, "sampled": len(sample),
                   "rich_total": len(rich), "distinct_funders": len(f)},
                  open("funders_summary.json", "w"), indent=1)


if __name__ == "__main__":
    main()
