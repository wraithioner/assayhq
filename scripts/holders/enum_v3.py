"""Full enumeration of Stock Token holders via Blockscout /api/v2 (cursor pagination).

Differences from the previous attempt:
  - tokens are worked SMALLEST FIRST, so progress is visible early and the long
    tail of small tokens is banked before the handful of huge ones;
  - each token checkpoints its rows + cursor every CHECKPOINT pages, so a restart
    resumes mid-token instead of redoing it;
  - per-page progress is logged for large tokens.

A token is marked .done only when its row count matches the declared holders_count
within TOLERANCE. Any reply lacking an "items" list is retried, never read as
end-of-list (Blockscout signals soft rate limits with a 200 + no items).
"""
import json, os, queue, threading, time, urllib.parse, urllib.request, urllib.error

BS = "https://robinhoodchain.blockscout.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
WORKERS = 8
TOLERANCE = 0.03
CHECKPOINT = 200
OUT = "rawv2"

lock = threading.Lock()
stats = {"pages": 0, "retries": 0, "done": 0, "short": 0, "rows": 0}


class Soft(Exception):
    pass


def get(url, tries=10):
    delay = 1.0
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.loads(r.read().decode())
            if not isinstance(d, dict) or not isinstance(d.get("items"), list):
                raise Soft(str(d)[:100])
            return d
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"items": [], "next_page_params": None}
            with lock:
                stats["retries"] += 1
            if i == tries - 1:
                raise
            time.sleep(delay * (3 if e.code == 429 else 1))
            delay = min(delay * 1.8, 60)
        except Exception:
            with lock:
                stats["retries"] += 1
            if i == tries - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.8, 60)


def fetch_token(m):
    base = f"{BS}/api/v2/tokens/{m['address']}/holders"
    path = f"{OUT}/{m['symbol']}_{m['address']}.tsv"
    ckpt = path + ".ckpt"

    rows, url, pages = [], base, 0
    if os.path.exists(ckpt):                       # resume mid-token
        st = json.load(open(ckpt))
        rows = [tuple(r) for r in st["rows"]]
        url = st["url"]
        pages = st["pages"]

    seen = set()
    big = m["holders_count"] > 20000
    while True:
        d = get(url)
        for it in d["items"]:
            a = it.get("address") or {}
            rows.append((a.get("hash", "").lower(), it.get("value", "0"),
                         "1" if a.get("is_contract") else "0"))
        pages += 1
        with lock:
            stats["pages"] += 1
        nxt = d.get("next_page_params")
        if not nxt:
            break
        key = json.dumps(nxt, sort_keys=True)
        if key in seen:
            break
        seen.add(key)
        url = base + "?" + urllib.parse.urlencode(nxt)
        if pages % CHECKPOINT == 0:
            json.dump({"rows": rows, "url": url, "pages": pages}, open(ckpt, "w"))
            if big:
                with lock:
                    print(f"    .. {m['symbol']} {len(rows):,}/{m['holders_count']:,} "
                          f"({pages} pages)", flush=True)
        if pages > (m["holders_count"] // 50) + 200:
            break
    if os.path.exists(ckpt):
        os.remove(ckpt)
    return rows


def work(q, total):
    while True:
        try:
            m = q.get_nowait()
        except queue.Empty:
            return
        path = f"{OUT}/{m['symbol']}_{m['address']}.tsv"
        try:
            rows = fetch_token(m)
        except Exception as e:
            with lock:
                print(f"  !! {m['symbol']}: {type(e).__name__} {e}", flush=True)
            continue
        dec = m["holders_count"]
        with open(path, "w") as f:
            for a, v, c in rows:
                f.write(f"{a}\t{v}\t{c}\n")
        if len(rows) < dec * (1 - TOLERANCE) - 5:
            with lock:
                stats["short"] += 1
                print(f"  ?? {m['symbol']}: declared {dec:,} fetched {len(rows):,} — NOT done", flush=True)
            continue
        open(path + ".done", "w").write(str(len(rows)))
        with lock:
            stats["done"] += 1
            stats["rows"] += len(rows)
            print(f"[{stats['done']:3d}/{total}] {m['symbol']:6s} dec={dec:>7,} got={len(rows):>7,} "
                  f"| pages={stats['pages']:,} rows={stats['rows']:,} retries={stats['retries']}",
                  flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = [m for m in json.load(open("token_meta.json")) if m["holders_count"]]
    meta.sort(key=lambda m: m["holders_count"])          # SMALLEST FIRST
    todo = [m for m in meta if not os.path.exists(f"{OUT}/{m['symbol']}_{m['address']}.tsv.done")]
    est = sum((m["holders_count"] + 49) // 50 for m in todo)
    print(f"tokens: {len(todo)} | est pages: {est:,} | workers: {WORKERS}", flush=True)
    q = queue.Queue()
    for m in todo:
        q.put(m)
    ts = [threading.Thread(target=work, args=(q, len(todo)), daemon=True) for _ in range(WORKERS)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    print(f"PASS COMPLETE done={stats['done']} short={stats['short']} rows={stats['rows']:,} "
          f"retries={stats['retries']}", flush=True)


if __name__ == "__main__":
    main()
