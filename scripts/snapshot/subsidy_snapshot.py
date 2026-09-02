#!/usr/bin/env python3
"""
Gas-subsidy comparison snapshot for Robinhood Chain (chain 4663).

The 90-day gas-fee waiver ends ~29 September 2026. Run this BEFORE and AFTER
that date; the diff measures how much of the chain's activity was rented.

    python3 scripts/snapshot/subsidy_snapshot.py            # write a snapshot (~5 min)
    python3 scripts/snapshot/subsidy_snapshot.py --full-holders   # exact holders (~2 h)
    python3 scripts/snapshot/subsidy_snapshot.py --diff a.json b.json

Design notes (why it is comparable across runs):
  * Every measurement is taken relative to the CURRENT head, over fixed spans,
    so each run measures the prevailing rate rather than a fixed historical
    window. The absolute head block and timestamp are always recorded.
  * The sampling scheme is deterministic given the head block, so two runs are
    methodologically identical.
  * Read-only. No archive node required.

Holder metrics (added 2026-09-02, before the subsidy expiry):
  * holderPositions is EXACT and cheap — the sum of every token's holders_count.
    If the holder base was rented, this is the number that collapses.
  * The value figures are a FIXED-DEPTH INDEX: the top HOLDER_TOPK holders of each
    token, priced with Chainlink. It is not the true total, and it is not meant to
    be. Two runs at the same depth are exactly comparable, which is what a diff
    needs. Measured against a complete enumeration on 2026-09-02, depth 200
    captured 95.11% of all priced value and 88.55% of customer-side value.
  * Depth does NOT approximate address counts. The same complete-enumeration check
    showed depth 200 catching only 28.6% of addresses over $100, because a holder
    with $500 spread over five tokens sits deep in all five lists. Address counts
    are therefore reported only for the index itself, never as a population
    estimate. Use --full-holders for the real distribution.

Counts and aggregates only. This script deliberately emits no per-address data.
"""
from __future__ import annotations
import argparse, collections, csv, datetime, json, os, subprocess, sys, time, urllib.parse

RPC = "https://rpc.mainnet.chain.robinhood.com"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"

# keccak("TransferWithScaledUI(address,address,uint256,uint256)")
TOPIC_TRANSFER_SCALED_UI = "0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802"
ZERO = "0x" + "0" * 40
POOL_TOKEN0_SELECTOR = "0x0dfe1681"  # token0() — identifies venue infrastructure

# Fixed sampling parameters. Do not change between runs, or the diff is meaningless.
DENSITY_SPAN = 500        # blocks, for movements/block
CHAIN_TX_BLOCKS = 100     # blocks sampled for chain-wide tx rate
AGENT_WINDOWS = 16        # sampled windows for sustained-address detection
AGENT_WINDOW_SPAN = 400   # blocks per window
AGENT_LOOKBACK = 40_000_000  # spread windows over this many blocks below head
SUSTAINED_MIN_WINDOWS = 3    # pre-committed "sustained" threshold
BLOCKS_PER_DAY = 864_000     # ~100ms blocks (verified empirically)
HOLDER_TOPK = 200            # value-index depth per token; changing it invalidates the diff
HOLDER_PAGE = 50             # Blockscout /api/v2 page size
BLOCKSCOUT = "https://robinhoodchain.blockscout.com"
SEL_LATEST_ROUND_DATA = "0xfeaf968c"
SEL_POOL_MANAGER = "0xdc4c90d3"  # V4 hooks; token0() alone misses the V4 singleton


def rpc(method: str, params: list, tries: int = 6):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    for _ in range(tries):
        r = subprocess.run(
            ["curl", "-sS", "--max-time", "180", "-A", UA,
             "-H", "content-type: application/json", "-X", "POST", RPC, "-d", payload],
            capture_output=True, text=True)
        try:
            j = json.loads(r.stdout)
            if "result" in j:
                return j["result"]
        except Exception:
            pass
    return None


def take_snapshot(full_holders: bool = False) -> dict:
    head = int(rpc("eth_blockNumber", []), 16)
    hb = rpc("eth_getBlockByNumber", [hex(head), False])
    head_ts = int(hb["timestamp"], 16)
    print(f"head={head} ts={datetime.datetime.utcfromtimestamp(head_ts).isoformat()}Z", file=sys.stderr)

    # 1. Stock Token movement rate (events/block over a fixed recent span)
    logs = rpc("eth_getLogs", [{"fromBlock": hex(head - DENSITY_SPAN), "toBlock": hex(head),
                                "topics": [TOPIC_TRANSFER_SCALED_UI]}])
    movements = len(logs) if isinstance(logs, list) else None
    per_block = (movements / DENSITY_SPAN) if movements is not None else None

    # 2. Chain-wide transaction rate
    tx_total, blocks_ok = 0, 0
    for b in range(head - CHAIN_TX_BLOCKS, head):
        blk = rpc("eth_getBlockByNumber", [hex(b), True])
        if blk:
            blocks_ok += 1
            tx_total += len(blk.get("transactions") or [])
    tx_per_block = (tx_total / blocks_ok) if blocks_ok else None

    # 3. Sustained, machine-cadence Stock Token addresses (venue pools excluded)
    starts = [head - AGENT_LOOKBACK + int(i * AGENT_LOOKBACK / (AGENT_WINDOWS - 1))
              for i in range(AGENT_WINDOWS)]
    seen: dict[str, set] = collections.defaultdict(set)
    sampled_events = 0
    for i, s in enumerate(starts):
        res = rpc("eth_getLogs", [{"fromBlock": hex(s), "toBlock": hex(s + AGENT_WINDOW_SPAN),
                                   "topics": [TOPIC_TRANSFER_SCALED_UI]}])
        if not isinstance(res, list):
            continue
        sampled_events += len(res)
        for l in res:
            t = l["topics"]
            for a in (("0x" + t[1][-40:]).lower(), ("0x" + t[2][-40:]).lower()):
                if a != ZERO:
                    seen[a].add(i)
    sustained = [a for a, w in seen.items() if len(w) >= SUSTAINED_MIN_WINDOWS]

    # exclude venue infrastructure (anything answering token0())
    pools = 0
    non_pool = []
    for a in sustained:
        code = rpc("eth_getCode", [a, "latest"]) or "0x"
        if len(code) > 2 and (rpc("eth_call", [{"to": a, "data": POOL_TOKEN0_SELECTOR}, "latest"]) or "0x") != "0x":
            pools += 1
        else:
            non_pool.append(a)

    ladder = {str(k): sum(1 for a, w in seen.items() if len(w) >= k and a in set(non_pool))
              for k in (3, 5, 8, 10, 12)}

    print("holder base ...", file=sys.stderr)
    holders = holder_base(full=full_holders)

    return {
        "schemaVersion": 2,
        "takenAtUtc": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "headBlock": head,
        "headTimestampUtc": datetime.datetime.utcfromtimestamp(head_ts).isoformat() + "Z",
        "method": {
            "densitySpanBlocks": DENSITY_SPAN, "chainTxBlocks": CHAIN_TX_BLOCKS,
            "agentWindows": AGENT_WINDOWS, "agentWindowSpanBlocks": AGENT_WINDOW_SPAN,
            "agentLookbackBlocks": AGENT_LOOKBACK,
            "sustainedMinWindows": SUSTAINED_MIN_WINDOWS, "blocksPerDay": BLOCKS_PER_DAY,
            "holderTopKPerToken": HOLDER_TOPK,
        },
        "stockTokenMovements": {
            "sampledEventsInSpan": movements, "perBlock": per_block,
            "estimatedPerDay": round(per_block * BLOCKS_PER_DAY) if per_block else None,
        },
        "chainTransactions": {
            "sampledBlocks": blocks_ok, "sampledTx": tx_total, "perBlock": tx_per_block,
            "estimatedPerDay": round(tx_per_block * BLOCKS_PER_DAY) if tx_per_block else None,
        },
        "agentLikeAddresses": {
            "sampledBlocks": AGENT_WINDOWS * AGENT_WINDOW_SPAN,
            "sampledEvents": sampled_events,
            "distinctParticipants": len(seen),
            "sustainedRaw": len(sustained),
            "venuePoolsExcluded": pools,
            "sustainedNonPool": len(non_pool),
            "ladderByMinWindows": ladder,
        },
        "holderBase": holders,
    }


# ---------------------------------------------------------------- holder base

def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _get_json(url: str, tries: int = 8):
    """Blockscout GET. A soft rate limit arrives as HTTP 200 with no payload, so a
    reply that lacks the expected shape is retried, never read as an empty result."""
    delay = 1.0
    for _ in range(tries):
        r = subprocess.run(["curl", "-sS", "--max-time", "120", "-A", UA,
                            "-H", "accept: application/json", url],
                           capture_output=True, text=True)
        try:
            j = json.loads(r.stdout)
        except Exception:
            j = None
        if isinstance(j, dict) and not (j.get("status") == "0"):
            return j
        time.sleep(delay); delay = min(delay * 1.8, 45)
    return None


def _load_csv(path: str) -> list:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _feed_prices(feeds: list) -> dict:
    out = {}
    for f in feeds:
        r = rpc("eth_call", [{"to": f["proxyAddress"], "data": SEL_LATEST_ROUND_DATA}, "latest"])
        if not isinstance(r, str) or len(r) < 2 + 64 * 5:
            continue
        answer = int(r[2:][64:128], 16)
        if answer >= 2 ** 255:
            answer -= 2 ** 256
        out[f["ticker"]] = answer / 10 ** int(f["decimals"])
    return out


def _token_holders(addr: str, limit: int | None) -> list:
    """Value-descending holder rows for one token. limit=None walks the whole list."""
    url = f"{BLOCKSCOUT}/api/v2/tokens/{addr}/holders"
    rows, seen = [], set()
    while True:
        d = _get_json(url)
        if not isinstance(d, dict) or not isinstance(d.get("items"), list):
            break
        for it in d["items"]:
            a = (it.get("address") or {}).get("hash", "").lower()
            rows.append((a, int(it.get("value") or 0)))
        nxt = d.get("next_page_params")
        if not nxt or (limit is not None and len(rows) >= limit):
            break
        key = json.dumps(nxt, sort_keys=True)
        if key in seen:
            break
        seen.add(key)
        url = f"{BLOCKSCOUT}/api/v2/tokens/{addr}/holders?" + urllib.parse.urlencode(nxt)
    return rows[:limit] if limit is not None else rows


def holder_base(full: bool = False) -> dict:
    root = _repo_root()
    tokens = _load_csv(os.path.join(root, "docs/data/stock-tokens.csv"))
    feeds = [f for f in _load_csv(os.path.join(root, "docs/data/chainlink-feeds.csv"))
             if f.get("kind") == "rh_total_return"]
    try:
        infra = set(json.load(open(os.path.join(root, "docs/data/chain/venue-infra.json")))["infra"])
    except Exception:
        infra = set()

    prices = _feed_prices(feeds)
    depth = None if full else HOLDER_TOPK
    positions, indexed, missing = 0, 0, []
    usd = collections.defaultdict(float)

    for i, t in enumerate(tokens):
        meta = _get_json(f"{BLOCKSCOUT}/api/v2/tokens/{t['address']}")
        hc = None
        if isinstance(meta, dict) and meta.get("holders_count") is not None:
            hc = int(meta["holders_count"])
            positions += hc
        else:
            missing.append(t["symbol"]); continue
        px = prices.get(t["symbol"])
        if px is None:
            continue                      # feed-less: counted in positions, never valued
        for a, v in _token_holders(t["address"], depth):
            if v:
                usd[a] += v / 1e18 * px
        indexed += 1
        if (i + 1) % 25 == 0:
            print(f"  holders {i+1}/{len(tokens)}", file=sys.stderr, flush=True)

    # refresh venue detection over the largest index addresses, so a NEW venue
    # (a V4-style singleton has no token0()) is not silently counted as a customer
    top = sorted(usd, key=lambda a: -usd[a])[:120]
    found = set()
    for a in top:
        if (rpc("eth_getCode", [a, "latest"]) or "0x") == "0x":
            continue
        for sel in (POOL_TOKEN0_SELECTOR, SEL_POOL_MANAGER):
            if (rpc("eth_call", [{"to": a, "data": sel}, "latest"]) or "0x") != "0x":
                found.add(a); break
    venue = infra | found

    vals = sorted(usd.values(), reverse=True)
    total = sum(vals)
    cust = {a: v for a, v in usd.items() if a not in venue}
    cust_total = sum(cust.values())

    def share(k):
        return round(sum(vals[:k]) / total, 6) if total and vals else None

    return {
        "mode": "full" if full else "index",
        "topKPerToken": depth,
        "tokensQueried": len(tokens),
        "tokensValued": indexed,
        "tokensMissingFromExplorer": missing,
        "holderPositions": positions,
        "addressesInIndex": len(usd),
        "pricedValueUsd": round(total, 2),
        "venueInfraAddresses": len(venue & set(usd)),
        "venueInfraValueUsd": round(total - cust_total, 2),
        "customerValueUsd": round(cust_total, 2),
        "indexAddressesOver": {str(t): sum(1 for v in cust.values() if v > t)
                               for t in (100, 1000, 10000, 100000)},
        "concentrationOfPricedValue": {"top1": share(1), "top10": share(10), "top100": share(100)},
        "coverage": (
            "EXACT — every holder of every token enumerated." if full else
            f"INDEX at depth {HOLDER_TOPK}. Comparable between runs at the same depth; not a "
            "population total. Against a complete enumeration on 2026-09-02 this depth held "
            "95.11% of priced value and 88.55% of customer value, but only 28.6% of addresses "
            "over $100 — so indexAddressesOver counts the INDEX, not the chain."
        ),
    }


def diff(a: dict, b: dict) -> dict:
    def pct(x, y):
        if x in (None, 0) or y is None:
            return None
        return round((y - x) / x * 100, 2)
    return {
        "before": {"headBlock": a["headBlock"], "at": a["headTimestampUtc"]},
        "after": {"headBlock": b["headBlock"], "at": b["headTimestampUtc"]},
        "stockMovementsPerDay": {
            "before": a["stockTokenMovements"]["estimatedPerDay"],
            "after": b["stockTokenMovements"]["estimatedPerDay"],
            "changePct": pct(a["stockTokenMovements"]["estimatedPerDay"], b["stockTokenMovements"]["estimatedPerDay"]),
        },
        "chainTxPerDay": {
            "before": a["chainTransactions"]["estimatedPerDay"],
            "after": b["chainTransactions"]["estimatedPerDay"],
            "changePct": pct(a["chainTransactions"]["estimatedPerDay"], b["chainTransactions"]["estimatedPerDay"]),
        },
        "sustainedAgentLikeAddresses": {
            "before": a["agentLikeAddresses"]["sustainedNonPool"],
            "after": b["agentLikeAddresses"]["sustainedNonPool"],
            "changePct": pct(a["agentLikeAddresses"]["sustainedNonPool"], b["agentLikeAddresses"]["sustainedNonPool"]),
        },
        "holderBase": _diff_holders(a.get("holderBase"), b.get("holderBase"), pct),
        "note": "Kill criteria: agent activity down >70% => the agent economy was rented. "
                "Stock Token holder positions or customer value down >70% => the holder base was rented.",
    }


def _diff_holders(a, b, pct):
    if not a or not b:
        return {"note": "one or both snapshots predate schemaVersion 2 (no holder metrics)"}
    out = {}
    if a.get("topKPerToken") != b.get("topKPerToken") or a.get("mode") != b.get("mode"):
        out["WARNING"] = (f"not comparable: before={a.get('mode')}/{a.get('topKPerToken')} "
                          f"after={b.get('mode')}/{b.get('topKPerToken')}")
    for k in ("holderPositions", "pricedValueUsd", "customerValueUsd",
              "venueInfraValueUsd", "addressesInIndex"):
        out[k] = {"before": a.get(k), "after": b.get(k), "changePct": pct(a.get(k), b.get(k))}
    ia, ib = a.get("indexAddressesOver") or {}, b.get("indexAddressesOver") or {}
    out["indexAddressesOver"] = {t: {"before": ia.get(t), "after": ib.get(t),
                                     "changePct": pct(ia.get(t), ib.get(t))}
                                 for t in sorted(set(ia) | set(ib), key=lambda x: int(x))}
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--diff", nargs=2, metavar=("BEFORE", "AFTER"))
    ap.add_argument("--full-holders", action="store_true",
                    help="enumerate every holder of every token (exact, ~2 h) "
                         "instead of the fixed-depth index (~5 min)")
    args = ap.parse_args()
    if args.diff:
        a = json.load(open(args.diff[0])); b = json.load(open(args.diff[1]))
        print(json.dumps(diff(a, b), indent=2))
    else:
        snap = take_snapshot(full_holders=args.full_holders)
        out = json.dumps(snap, indent=2)
        if args.out:
            open(args.out, "w").write(out + "\n")
            print(f"wrote {args.out}", file=sys.stderr)
        print(out)
