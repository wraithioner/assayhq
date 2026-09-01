#!/usr/bin/env bash
# Phase 0 recon verification — reproduces the primary-source checks behind docs/RECON.md.
# Read-only: JSON-RPC eth_call/eth_getCode/eth_getLogs, Blockscout REST, public HTTPS APIs.
# No keys, no writes, no transactions. Requires: bash, curl, python3.
set -euo pipefail
RPC="${RH_RPC:-https://rpc.mainnet.chain.robinhood.com}"
EXPLORER="https://robinhoodchain.blockscout.com"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"
jrpc(){ curl -sSL --max-time 40 -A "$UA" -H 'content-type: application/json' -X POST "$RPC" -d "$1"; echo; }
here="$(cd "$(dirname "$0")" && pwd)"

echo "# 1. Chain identity"
jrpc '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'      # expect 0x1237 = 4663
jrpc '{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}'

AAPL_TOKEN="0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"
echo "# 2. AAPL stock token: decimals(), symbol(), uiMultiplier()"
jrpc '{"jsonrpc":"2.0","id":3,"method":"eth_call","params":[{"to":"'$AAPL_TOKEN'","data":"0x313ce567"},"latest"]}'  # 0x..12 = 18
jrpc '{"jsonrpc":"2.0","id":4,"method":"eth_call","params":[{"to":"'$AAPL_TOKEN'","data":"0x95d89b41"},"latest"]}'  # "AAPL"
jrpc '{"jsonrpc":"2.0","id":5,"method":"eth_call","params":[{"to":"'$AAPL_TOKEN'","data":"0xa60bf13d"},"latest"]}'  # uiMultiplier == rhj/assets currentMultiplier

echo "# 3. Shared token implementation (beacon proxy) event ABI"
echo "   token beacon slot -> beacon -> implementation() -> Blockscout getabi"
echo "   implementation 0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2 emits:"
echo "     TransferWithScaledUI(address indexed,address indexed,uint256,uint256)"
echo "     UIMultiplierUpdated(uint256,uint256,uint256)"

echo "# 4. Event topic0 hashes (self-tested keccak256)"
python3 "$here/keccak.py"

echo "# 5. ERC-8004 registries have code on Robinhood Chain"
for a in 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63; do
  jrpc '{"jsonrpc":"2.0","id":6,"method":"eth_getCode","params":["'$a'","latest"]}'
done

echo "# 6. Uniswap V3 Factory has code (chain 4663)"
jrpc '{"jsonrpc":"2.0","id":7,"method":"eth_getCode","params":["0x1f7d7550b1b028f7571e69a784071f0205fd2efa","latest"]}'

echo "# 7. Chainlink AAPL total-return feed decimals()==8 + latestRoundData()"
AAPL_FEED="0x6B22A786bAa607d76728168703a39Ea9C99f2cD0"
jrpc '{"jsonrpc":"2.0","id":8,"method":"eth_call","params":[{"to":"'$AAPL_FEED'","data":"0x313ce567"},"latest"]}'
jrpc '{"jsonrpc":"2.0","id":9,"method":"eth_call","params":[{"to":"'$AAPL_FEED'","data":"0xfeaf968c"},"latest"]}'

echo "# 8. Refresh primary-source snapshots (optional; overwrites docs/data/*.raw.json)"
echo "   curl 'https://api.robinhood.com/rhj/assets' -> docs/data/rh-assets.raw.json"
echo "   curl 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json' -> docs/data/chainlink-feeds-robinhood-mainnet.raw.json"
echo
echo "Note: the public RPC rate-limits (HTTP 429) after a few rapid calls; use Alchemy or add backoff."
