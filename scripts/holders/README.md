# Stock Token holder-base measurement

Read-only scripts behind [`docs/HOLDER_BASE.md`](../../docs/HOLDER_BASE.md). Run in order
from this directory, with `docs/data/stock-tokens.csv` and `docs/data/chainlink-feeds.csv`
copied alongside them.

| Script | What it does |
|---|---|
| `rpc.py` | JSON-RPC helper. Uses `curl`, because the agent proxy 403s Python `urllib` POSTs. |
| `fetch_meta.py` | Exact `holders_count` / supply for all 194 tokens → `token_meta.json` |
| `price.py` | `latestRoundData()` on the 35 `rh_total_return` feeds → `prices.json` |
| `enum_v3.py` | Enumerates every token's holder list via `/api/v2` → `rawv2/*.tsv` |
| `topn.py` | Top-N prefix for one token, when a full pass is too slow |
| `build.py` | Merges lists + prefixes → `addr_values.tsv`, with the missed-value bound |
| `classify.py` | EOA / EIP-7702 / contract split, exact above $1k and sampled below |
| `identify.py` | Names the top holders via Blockscout |
| `infra.py` | Builds the venue-infrastructure set → `infra.json` |
| `final_analysis.py` | Distribution, histogram, concentration |
| `cohorts.py` | `growth N` for first-acquisition weeks; `funders N` for funding sources |

Two operational notes, both load-bearing:

- **Use `/api/v2`, not `/api`.** The legacy endpoint supports numeric offsets and 1,000 rows
  per request but rate-limits hard and stays banned for hours. `/api/v2` sustained 8.7 req/s.
- **A soft rate limit arrives as HTTP 200** with `{"status":"0","message":"Too many requests"}`.
  Parsed naively it looks like an empty page and silently truncates a holder list. Every
  fetcher here treats it as retryable, and no token is accepted unless its row count matches
  the declared `holders_count`.

Send a browser `User-Agent`; Blockscout returns a Cloudflare challenge otherwise.
