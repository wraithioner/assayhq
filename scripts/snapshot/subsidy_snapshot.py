#!/usr/bin/env python3
"""
Gas-subsidy comparison snapshot for Robinhood Chain (chain 4663).

The 90-day gas-fee waiver ends ~29 September 2026. Run this BEFORE and AFTER
that date; the diff measures how much of the chain's activity was rented.

    python3 scripts/snapshot/subsidy_snapshot.py            # write a snapshot
    python3 scripts/snapshot/subsidy_snapshot.py --diff a.json b.json

Design notes (why it is comparable across runs):
  * Every measurement is taken relative to the CURRENT head, over fixed spans,
    so each run measures the prevailing rate rather than a fixed historical
    window. The absolute head block and timestamp are always recorded.
  * The sampling scheme is deterministic given the head block, so two runs are
    methodologically identical.
  * Read-only. No archive node required.

Counts only. This script deliberately emits no per-address data.
"""
from __future__ import annotations
import argparse, json, subprocess, sys, collections, datetime

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


def take_snapshot() -> dict:
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

    return {
        "schemaVersion": 1,
        "takenAtUtc": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "headBlock": head,
        "headTimestampUtc": datetime.datetime.utcfromtimestamp(head_ts).isoformat() + "Z",
        "method": {
            "densitySpanBlocks": DENSITY_SPAN, "chainTxBlocks": CHAIN_TX_BLOCKS,
            "agentWindows": AGENT_WINDOWS, "agentWindowSpanBlocks": AGENT_WINDOW_SPAN,
            "agentLookbackBlocks": AGENT_LOOKBACK,
            "sustainedMinWindows": SUSTAINED_MIN_WINDOWS, "blocksPerDay": BLOCKS_PER_DAY,
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
        "note": "Kill criterion from the build plan: agent activity down >70% => the agent economy was rented.",
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--diff", nargs=2, metavar=("BEFORE", "AFTER"))
    args = ap.parse_args()
    if args.diff:
        a = json.load(open(args.diff[0])); b = json.load(open(args.diff[1]))
        print(json.dumps(diff(a, b), indent=2))
    else:
        snap = take_snapshot()
        out = json.dumps(snap, indent=2)
        if args.out:
            open(args.out, "w").write(out + "\n")
            print(f"wrote {args.out}", file=sys.stderr)
        print(out)
