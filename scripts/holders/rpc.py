"""JSON-RPC over curl: the agent proxy 403s python-urllib POSTs, curl works."""
import json, subprocess, time
RPC = "https://rpc.mainnet.chain.robinhood.com"
_id = [0]

def rpc_batch(calls, tries=8):
    """calls: list of (method, params). Returns list of results (None on error)."""
    payload = []
    for m, p in calls:
        _id[0] += 1
        payload.append({"jsonrpc": "2.0", "id": _id[0], "method": m, "params": p})
    body = json.dumps(payload)
    delay = 0.6
    for i in range(tries):
        r = subprocess.run(
            ["curl", "-sS", "-X", "POST", RPC, "-H", "content-type: application/json",
             "--max-time", "120", "--data-binary", "@-"],
            input=body, capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip().startswith(("[", "{")):
            try:
                d = json.loads(r.stdout)
            except json.JSONDecodeError:
                d = None
            if isinstance(d, list):
                by = {x["id"]: x for x in d}
                return [by.get(p["id"], {}).get("result") for p in payload]
            if isinstance(d, dict) and "result" in d:
                return [d["result"]]
        time.sleep(delay); delay = min(delay * 2, 45)
    return [None] * len(payload)

def rpc(method, params):
    return rpc_batch([(method, params)])[0]

def call(to, data, block="latest"):
    return rpc("eth_call", [{"to": to, "data": data}, block])

def call_batch(items, block="latest"):
    """items: list of (to, data)."""
    return rpc_batch([("eth_call", [{"to": t, "data": d}, block]) for t, d in items])
