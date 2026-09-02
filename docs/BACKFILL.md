# BACKFILL — agent population diagnostic

**Question:** does a scoreable population of autonomous trading agents actually exist on
Robinhood Chain (chain 4663) today?

**Answer: effectively no. One address survives every gate, and it has 4 stock-token
movements in total.** The board is empty in any statistically meaningful sense. This is
reported as a finding about the ecosystem, not a defect to be engineered around — no gate
was relaxed to manufacture a population (see [Hard guard](#hard-guard)).

**Run date:** 2026-09-02 · **chain head at scan:** 52,428,883 · **scan floor:** block
34,617,892 (the first `Registered` event; no agent identity existed before it).

---

## Headline funnel

| Gate | Surviving | Note |
|---|---|---|
| ERC-8004 registrations | **61** | agentIds 0–60 |
| Unique owner addresses | **45** | 4 owners hold >1 identity (one holds 11) |
| …with ANY Stock Token movement after their own registration block | **3** | 42 of 45 owners have never moved a Stock Token |
| …majority feed-covered (D1, the 35 Chainlink-covered tokens) | **3** | all three are 100% feed-covered |
| …surviving the unattributed-flow detector | **1** | 2 of 3 excluded |
| **Final scoreable population** | **1** | and it has only 4 movements (3 attributed) |

---

## (a) Does an ERC-8004 registry exist on chain 4663?

**Yes.** It is live and in use, and it is *not* referenced anywhere in Robinhood's own
developer documentation — it was found by probing the standard ERC-8004 vanity addresses
and then confirmed on-chain.

| | |
|---|---|
| **IdentityRegistry (proxy)** | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (ERC-1967) |
| **Deploy block** | **12,058,809** (timestamp `1784285232`) |
| Creation tx | `0xaa0d849726bc5035b83cb717cd3d060094b227c642fd718da206f64e5b5fee4c` |
| Creator | `0xbf551eed83c7eaee63854a2013eb94f18600b7c5` |
| Implementation | `0x7274e874CA62410a93Bd8bf61c69d8045E399c02` — `IdentityRegistryUpgradeable` (verified) |
| **ReputationRegistry (proxy)** | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Reputation implementation | `0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34` — `ReputationRegistryUpgradeable` (verified) |

**How the code was confirmed** (all reproducible, read-only):

1. `eth_getCode` on the proxy returns 130 bytes — a canonical ERC-1967 proxy body, not empty.
2. `eth_call name()` → `"AgentIdentity"`; `symbol()` → `"AGENT"` — it is an ERC-721 identity NFT.
3. Blockscout resolves the EIP-1967 implementation slot to a **verified** contract named
   `IdentityRegistryUpgradeable`, whose ABI carries
   `Registered(uint256 indexed agentId, string agentURI, address indexed owner)` plus
   `getAgentWallet`/`setAgentWallet`.
4. A Validation registry (the third ERC-8004 registry) was **not** found at the probed
   address pattern.

## (b) Registrations to date

**61 registrations**, `agentId` 0 → 60, across **45 unique owner addresses**, spanning
blocks **34,617,892 → 52,428,883**.

Identity is concentrated — a plain Sybil signal that matters for any cohort statistic:

| Owner | identities |
|---|---|
| `0x56eaf0dc0472ea9b35fe8b9f5a5ea2ddb90762f0` | 11 (ids 16–26) |
| `0xda977767452c5dd021624511f14df67b6c9c2c1b` | 4 (ids 27, 35, 36, 37) |
| `0x153371545bb05aaf13af1d1a6adae7b12465e36d` | 3 (ids 7, 8, 9) |
| `0xd887b96a94ffbc4ea74c8a7dae7fbadd8b235334` | 2 (ids 13, 14) |

Registrations also arrive in bursts from one sender (ids 38–53 land within ~100 blocks),
consistent with scripted batch registration rather than 61 independent operators.

The full list (agentId, owner, block, tx) is in
[`docs/data/backfill/registrations.json`](./data/backfill/registrations.json).

## (c) How many have Stock Token activity after registration?

**3 of 45.** Across every registered owner there are only **42** `TransferWithScaledUI`
movements in total, from the first registration to chain head.

Note: **0** movements fell before their owner's registration block, so the D3
"never backfill pre-registration history" rule excluded nothing here — the population is
small because it is genuinely inactive, not because D3 trimmed it.

| Owner | reg. block | movements | tokens |
|---|---|---|---|
| `0xc1871e64ab4f4aa0add627b32ee4a49b9c295c05` | 42,055,049 | 36 | AAPL, GOOGL, MSFT, NVDA, SPCX, TSLA |
| `0x38d4bb8d734f8ca1612b5702c32aabe32ea98b8b` | 41,174,827 | 4 | AMZN, NVDA, SNDK |
| `0xf84d619d7af63bc7fc40c308e1e18445c57271e7` | 52,428,883 | 2 | NVDA |

**42 of the 45 registered owners have never moved a Stock Token at all.**

## (d) How many are scoreable under D1 (majority feed-covered)?

**3 of 45** — all three trade *exclusively* in the 35 Chainlink-covered tokens, so the
feed-coverage gate rejects none of them. The 35/194 coverage gap is not what empties this
board.

## (e) How many are excluded by the unattributed-flow detector?

**2 of 3 excluded → final scoreable population = 1.**

| Owner | attributed to a Uniswap V3 swap | unattributed | verdict |
|---|---|---|---|
| `0xc1871e64…` | 5 / 36 | 31 | **EXCLUDED** |
| `0x38d4bb8d…` | 3 / 4 | 1 | included |
| `0xf84d619d…` | 0 / 2 | 2 | **EXCLUDED** |

This is not a detector artifact. A representative unattributed transaction
(`0x26ab3714ad66afec5a297a7d8e6c69b674dd5653f1abfa731ee8ee9c7bb5790a`) contains exactly
**two** logs — `Transfer` and `TransferWithScaledUI` on NVDA — and **no `Swap` event, no
quote-asset leg, and no DEX interaction of any kind**. It is a one-way token send into a
contract, not a trade. There is no execution price to measure, so there is nothing to score.

### Counterparty contracts accounting for the unattributed volume (ranked)

| Counterparty | moves | raw volume (tokens) | what it is |
|---|---|---|---|
| `0xba4fe29672e7825f7699ccc415cce6983e8dd652` | 6 | 0.2032 | EIP-1167 clone → `RHBTCAccount` |
| `0x766394cdd0a26876f9dd7e6cb6113f711e241ba5` | 6 | 0.0718 | EIP-1167 clone → `RHBTCAccount` |
| `0xf906d1ea34326283c2ea172554be7c120105a96d` | 6 | 0.0540 | EIP-1167 clone → `RHBTCAccount` |
| `0x9dd0e005bedc76b432a9c221b18283fa7012665a` | 6 | 0.0540 | EIP-1167 clone → `RHBTCAccount` |
| `0xe6f1f17560cc7c4cebb8a48e3e2029a926267f72` | 6 | 0.0525 | EIP-1167 clone → `RHBTCAccount` |
| `0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e` | 1 | 0.0829 | unverified contract (1,932 B) |
| `0x111116053f09d34a7eae8102887004445176ca11` | 1 | 0.0770 | unverified contract (21,567 B) |
| `0xbdbae060cbab0e9cfe802a7513dd5ecb36cda6c3` | 1 | 0.0229 | unverified contract (1,168 B) |
| `0xf574664c58f37033a6cfb6b092d7d8972fb9a2d2` | 1 | 0.0007 | unverified contract (291 B) |

**The top five are the same contract five times over.** Each is a 173-byte EIP-1167
minimal proxy *with immutable args*, and all five delegate to one verified implementation,
`RHBTCAccount` at `0xaaf7bb9d1a9e51eb87fd86a2df818e72bf5e3baa`. Their immutable tails
encode chain id `0x1237` (4663) and a `ProtocolProxy` at
`0x8c71d170fbd94bcba93bb08fc2cfd0e8620cd9ce`, which resolves to a verified implementation
named **`RHMachines`** (`0x776a66e24FdC8bd26C5a51F3dA6b6D03b9242C7E`).

So the single largest "agent" on the registry is not trading: it is depositing Stock Tokens
into per-account `RHBTCAccount` clones of the **RHMachines** protocol. **RHMachines is
therefore the #1 ranked candidate for the next venue integration** — it accounts for 30 of
the 34 unattributed movements. Integrating it would convert deposits into positions we can
value, but note it would still not produce *execution prices*, so it changes NAV coverage,
not slippage measurement.

---

## Hard guard — what was NOT done

The scoreable population is 1. Per the standing instruction, none of the following was
done to inflate it:

- Pre-registration history was **not** backfilled into scoring (and would not have helped:
  zero movements predate their owner's registration).
- D3 (scoring starts at the registration block) was **not** relaxed.
- Behavioural heuristics remain **display-only**; none were promoted to scoring.
- D1 was **not** widened to the 159 feed-less tokens (and would not have helped: all three
  active owners are already 100% feed-covered).

**The honest reading:** ERC-8004 registration on this chain is currently a cheap,
largely ceremonial act — 61 identities, 45 owners, mostly batch-registered, and 93% of them
have never touched a Stock Token. The one address that both trades feed-covered tokens and
executes on an indexed venue has 4 movements, which cannot support a Sharpe ratio, an
information ratio, or a drawdown series. Publishing a leaderboard from this would be
publishing noise.

## Method & reproducibility

Everything above is read-only and derived from chain state plus Blockscout's verified-contract
metadata. No archive endpoint was required — the public RPC accepted `eth_getLogs` over the
full 18M-block range because the filters are narrow.

```bash
# (b) every registration, from genesis, in one call
#     topic0 = keccak("Registered(uint256,string,address)")
curl -s -X POST https://rpc.mainnet.chain.robinhood.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{
        "fromBlock":"0x0","toBlock":"latest",
        "address":"0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        "topics":["0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a"]}]}'

# (c) every Stock Token movement touching any agent owner, in two calls
#     topic0 = keccak("TransferWithScaledUI(address,address,uint256,uint256)")
#     topics[1] = [owner...]  (from-side)   |   topics[2] = [owner...]  (to-side)
#     0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802

# (e) attribution: a movement counts only if its receipt carries a Uniswap V3 Swap log
#     topic0 = keccak("Swap(address,address,int256,int256,uint160,uint128,int24)")
#     0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67
```

Raw intermediates are committed under [`docs/data/backfill/`](./data/backfill) so a third
party can recheck the funnel without re-scanning the chain.
