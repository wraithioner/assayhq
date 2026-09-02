"""Fetch the top-N holders (value-descending prefix) for one token, into a .ckpt file
that build.py already knows how to read.

Usage: python3 topn.py NVDA 600      # 600 pages = top 30,000 holders
"""
import json, os, sys, time, urllib.parse, urllib.request, urllib.error

BS = "https://robinhoodchain.blockscout.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def get(url, tries=10):
    delay = 1.0
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.loads(r.read().decode())
            if not isinstance(d, dict) or not isinstance(d.get("items"), list):
                raise ValueError("soft limit / no items")
            return d
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"items": [], "next_page_params": None}
            if i == tries - 1:
                raise
            time.sleep(delay * (3 if e.code == 429 else 1))
            delay = min(delay * 1.8, 60)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.8, 60)


sym = sys.argv[1]
maxpages = int(sys.argv[2]) if len(sys.argv) > 2 else 600
m = [x for x in json.load(open("token_meta.json")) if x["symbol"] == sym][0]
base = f"{BS}/api/v2/tokens/{m['address']}/holders"
path = f"rawv2/{sym}_{m['address']}.tsv"
ckpt = path + ".ckpt"

rows, url, pages = [], base, 0
print(f"{sym}: declared {m['holders_count']:,} holders, fetching up to {maxpages} pages", flush=True)
while pages < maxpages:
    d = get(url)
    for it in d["items"]:
        a = it.get("address") or {}
        rows.append([a.get("hash", "").lower(), it.get("value", "0"),
                     "1" if a.get("is_contract") else "0"])
    pages += 1
    nxt = d.get("next_page_params")
    if pages % 50 == 0 or not nxt:
        json.dump({"rows": rows, "url": url, "pages": pages}, open(ckpt, "w"))
        print(f"  {len(rows):,}/{m['holders_count']:,} ({pages} pages) "
              f"smallest={int(rows[-1][1])/1e18:.12f}", flush=True)
    if not nxt:
        open(path, "w").write("".join(f"{a}\t{v}\t{c}\n" for a, v, c in rows))
        open(path + ".done", "w").write(str(len(rows)))
        print(f"{sym}: COMPLETE {len(rows):,}", flush=True)
        os.remove(ckpt)
        break
    url = base + "?" + urllib.parse.urlencode(nxt)
else:
    json.dump({"rows": rows, "url": url, "pages": pages}, open(ckpt, "w"))
    print(f"{sym}: prefix saved {len(rows):,} rows", flush=True)
