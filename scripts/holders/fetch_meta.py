import csv, json, os, time, urllib.request, urllib.error, sys

BS = "https://robinhoodchain.blockscout.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def get(url, tries=6):
    """Returns (json|None, status). 404 -> (None, 404) without retrying."""
    delay = 1.0
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode()), 200
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, 404
            if i == tries - 1:
                return None, e.code
            time.sleep(delay); delay = min(delay * 2, 30)
        except Exception:
            if i == tries - 1:
                return None, -1
            time.sleep(delay); delay = min(delay * 2, 30)
    return None, -1

tokens = list(csv.DictReader(open("stock-tokens.csv")))
out = json.load(open("token_meta.json")) if os.path.exists("token_meta.json") else []
done = {o["address"] for o in out}

for i, t in enumerate(tokens):
    if t["address"] in done:
        continue
    d, st = get(f"{BS}/api/v2/tokens/{t['address']}")
    if d is None:
        out.append({"symbol": t["symbol"], "address": t["address"], "http": st,
                    "holders_count": None, "total_supply": None, "exchange_rate": None,
                    "circulating_market_cap": None, "decimals": None})
    else:
        out.append({
            "symbol": t["symbol"], "address": t["address"], "http": 200,
            "holders_count": int(d["holders_count"]) if d.get("holders_count") is not None else None,
            "total_supply": d.get("total_supply"),
            "exchange_rate": d.get("exchange_rate"),
            "circulating_market_cap": d.get("circulating_market_cap"),
            "decimals": int(d.get("decimals") or 18),
        })
    if (i + 1) % 40 == 0:
        json.dump(out, open("token_meta.json", "w"), indent=1)
        print(f"  {i+1}/{len(tokens)}", file=sys.stderr, flush=True)
    time.sleep(0.35)

json.dump(out, open("token_meta.json", "w"), indent=1)
ok = [o for o in out if o["holders_count"] is not None]
bad = [o for o in out if o["holders_count"] is None]
tot = sum(o["holders_count"] for o in ok)
print(f"tokens queried      : {len(out)}")
print(f"  indexed as token  : {len(ok)}")
print(f"  NOT on blockscout : {len(bad)}  {[ (b['symbol'], b['http']) for b in bad ][:12]}")
print(f"sum holders_count (holder POSITIONS, not distinct addresses): {tot:,}")
print(f"pages at offset=1000 for FULL enumeration: {sum((o['holders_count']+999)//1000 for o in ok):,}")
