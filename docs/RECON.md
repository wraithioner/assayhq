# RECON — Robinhood Chain ground truth (Phase 0)

**Project:** Robinhood Chain Agent Scoreboard — a read-only leaderboard scoring autonomous
trading agents on Robinhood Chain, with measurement integrity (survivorship, costs,
point-in-time) as the product.

**Status:** Phase 0 (recon) complete. **No application code written.** This document plus the
snapshots in [`docs/data/`](./data) and the read-only checks in
[`scripts/recon/verify.sh`](../scripts/recon/verify.sh) are the whole deliverable.

**As of:** 2026-09-01 (UTC). Chain at block ~51,655,000.

**Method / trust rules.** Every fact below is tagged with how it was established:
- **[docs]** — Robinhood Chain docs (`https://docs.robinhood.com/chain/*`), read from raw SSR HTML, not a summarizer.
- **[onchain]** — verified against the live chain over the public RPC / Blockscout (`eth_call`, `eth_getCode`, `eth_getLogs`, verified ABIs). This is the source of record when it disagrees with any doc.
- **[api]** — Robinhood public data API (`api.robinhood.com/rhj/*`) or Chainlink's reference-data directory.
- **[press]** — news/press, used only where no primary source exists (flagged explicitly).

Where a value could not be verified from a primary source, it is marked **OPEN** and **not guessed**.
Two early doc-summarizer readings were wrong and were corrected against `[onchain]` truth
(see [§9 Corrections](#9-corrections)). Full addresses are in [`docs/data/`](./data); this file
carries the load-bearing ones inline.

---

## 1. Chain parameters, RPC, explorer, indexing

| Item | Value | Source |
|---|---|---|
| Network | Robinhood Chain — Arbitrum Orbit L2 (Nitro / ArbOS; standard Arb precompiles `0x64`–`0x72`, `0xC8` present) | [docs][onchain] |
| **Chain ID (mainnet)** | **4663** (`0x1237`) — confirmed via `eth_chainId` | [onchain] |
| Chain ID (testnet) | 46630 | [docs] |
| Native gas token | ETH | [docs] |
| **Public RPC (HTTP)** | `https://rpc.mainnet.chain.robinhood.com` — working (`eth_chainId`, `eth_call`, `eth_getLogs` all OK) | [onchain] |
| Alchemy RPC (recommended) | `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` | [docs] |
| Sequencer feed (WS) | `wss://feed.mainnet.chain.robinhood.com` | [docs] |
| **Block explorer** | `https://robinhoodchain.blockscout.com` — Blockscout, with a full REST/`/api/v2` (verified ABIs, token stats, logs) | [docs][onchain] |
| Other RPC providers | QuickNode, Blockdaemon, dRPC, Validation Cloud | [docs] |
| Indexing / archive | **Alchemy** integrated. Blockscout `/api/v2` usable for logs/contracts/token stats. `eth_getLogs` over ≥4,000-block ranges works on the public RPC. | [docs][onchain] |

**Operational notes for the indexer:**
- The **public RPC rate-limits** — HTTP `429` after ~3 rapid calls in a burst. Use Alchemy for backfill, or exponential backoff + low concurrency on the public endpoint. **[onchain]**
- **Genesis block 0 `timestamp == 0`** (an Orbit artifact). Do **not** derive the launch date from chain state; real blocks carry correct wall-clock (latest block ≈ now, confirmed). Use block timestamps from real blocks only. **[onchain]**
- Blocks are sub-second (≈51.6M blocks in the ~62 days since launch) → backfill is large; plan for it. **[onchain]**
- "Allium" indexing (mentioned in the brief) is **not** referenced in the docs — **OPEN / unverified**.

---

## 2. Stock Token & ETF contracts

**Source of record:** `https://api.robinhood.com/rhj/assets` (public JSON; the `/chain/contracts`
page renders from it client-side). Sibling endpoints: `/rhj/corporate-actions`, `/rhj/prices/`. **[api]**

- **194 assets**, snapshot 2026-09-01. **All** `chainId 4663`, **all ERC-20 with 18 decimals**, **all `ASSET_STATUS_ACTIVE`**. **[api]**
- Stock tokens and tokenized **ETFs share one list** — there is no `assetType` flag. ETFs are identifiable by symbol/ISIN (e.g. SGOV, SPY, QQQ, SLV, USO). **[api]**
- Full machine-readable list: [`docs/data/stock-tokens.csv`](./data/stock-tokens.csv) (194 rows) and the raw response [`docs/data/rh-assets.raw.json`](./data/rh-assets.raw.json) (sha256 in [`PROVENANCE.json`](./data/PROVENANCE.json)).
- Fixed infra tokens: **WETH** `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, **USDG** `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. **[docs][onchain]**

**Token contract shape [onchain]:** every stock token is a **BeaconProxy** (EIP-1967 beacon) over a
**single shared implementation** `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2`
(beacon `0xe10b6f6b275de231345c20d14ab812db62151b00`). **One ABI covers all 194 tokens.** The
implementation is verified on Blockscout as an ERC-20 + EIP-2612 permit token with the ERC-8056
extension (see §4), plus `pause`/`unpause`, an **oracle pause** (`pauseOracle`/`oraclePaused`),
`adminBurn`/`mint`, `setMetadata`, and an **`ACCESS_CONTROLLED_REGISTRY`** hook (transfers may be
permissioned/compliance-gated — **flag for Phase 1**, see §8/§10).

**Corporate actions are live now.** 9 of 194 tokens carry a `currentMultiplier ≠ 1.0` (0 pending):

| Symbol | Address | currentMultiplier | ISIN | Name |
|---|---|---|---|---|
| CRWD | `0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931` | 4.000000000000000000 | US22788C1053 | CrowdStrike |
| ORCL | `0xb0992820E760d836549ba69BC7598b4af75dEE03` | 1.002210914971013375 | US68389X1054 | Oracle |
| CCL | `0x9651342CeA770aE9a2969Ba2A52611523146aef9` | 1.021486444855206408 | BMG2004J1036 | Carnival |
| SGOV | `0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5` | 1.005101770003214918 | US46436E7186 | iShares 0-3mo Treasury (ETF) |
| COST | `0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2` | 1.000612040296259656 | US22160K1051 | Costco |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | 1.000566080061092436 | US0378331005 | Apple |
| ASML | `0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA` | 1.000101323251417769 | USN070592100 | ASML |
| MU | `0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD` | 1.000074823219171086 | US5951121038 | Micron |
| DELL | `0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd` | 1.000063708620124549 | US24703L2025 | Dell |

CRWD's `4.0` is the largest active adjustment (corporate-action driven; e.g. a split). SGOV/CCL's
lift reflects accrued distributions. All values are **on-chain verified** (see §4 cross-check).

A few majors for reference: NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`,
TSLA `0x322F0929c4625eD5bAd873c95208D54E1c003b2d`,
MSFT `0xe93237C50D904957Cf27E7B1133b510C669c2e74`,
GOOGL `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3`,
SPY `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C`,
QQQ `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68`.

---

## 3. Chainlink price feeds

**Source of record:** `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`
(Chainlink's machine-readable directory; the docs page
`docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood` renders from the same data and says
to read addresses there, **not** hardcode them). **[api][docs]** Full table:
[`docs/data/chainlink-feeds.csv`](./data/chainlink-feeds.csv).

- **57 feeds** on RH mainnet = **35 "Robinhood `<TICKER>`" total-return equity/ETF feeds** + **22 standard** crypto/FX/stable feeds (BTC, ETH, LINK, USDG, USDC, USDT, WBTC, …). **[api]**
- **Decimals = 8** (confirmed on-chain: AAPL feed `decimals()` → `8`). Heartbeat **86400 s (24h)**, threshold 0.5%, market hours **`us_equities_24/5`**, standard `AggregatorV3Interface`. **[api][onchain]**
- Feeds are **SVR-enabled**: per feed, `proxyAddress` is the SVR feed and `secondaryProxyAddress` the standard variant. The docs' consumer reads `proxyAddress.latestRoundData()`. **[api]**
- **Multiplier is already included — do not re-apply it.** Verbatim **[docs]**: *"The feed returns the price of one token, which is the underlying share price times the multiplier. `latestRoundData()` returns this directly, so you don't apply the multiplier yourself."* Chainlink **[docs]**: the feed reports the **Total Return Value** of the token, *"combining the underlying equity's market price with a multiplier"* and reflecting *"total return … including dividends."*
  - **NAV of a raw balance:** `usd = rawBalance(1e18) × answer(1e8) / 1e18 / 1e8`. No `uiMultiplier` factor. The ERC-8056 conversion (§4) is for *share accounting*, not USD NAV.
  - Live check: AAPL feed `latestRoundData().answer` ≈ **315.64 USD**, `updatedAt` a 2026 timestamp. **[onchain]**

> ### ⚠ Coverage gap (measurement risk not anticipated by the brief)
> **Only 35 of the 194 stock tokens have a Chainlink total-return feed. 159 tokens have none.**
> The 35 covered: AAPL, AMD, AMZN, ASML, BABA, CLSK, COIN, CRCL, CRWV, DELL, EWY, GME, GOOGL,
> INTC, IONQ, META, MSFT, MSTR, MU, NBIS, NVDA, ORCL, PLTR, QQQ, RGTI, RKLB, SGOV, SLV, SNDK,
> SPCX, SPY, TSLA, TSM, USAR, USO.
> For the other 159, NAV/slippage cannot use a Chainlink mid. Options for Phase 1 (all imperfect):
> the RH prices API (`/rhj/prices/`, off-chain, not third-party-recomputable), or the DEX pool
> mid (endogenous — the very price the agent trades against, so it can't measure that agent's
> slippage cleanly). **This is a real threat to the "net of slippage, vs an exogenous mid" promise
> and should be resolved before scoring uncovered tokens.**

Sample feeds (`ticker | proxyAddress | secondaryProxyAddress | decimals | heartbeat`):

| AAPL | `0x6B22A786bAa607d76728168703a39Ea9C99f2cD0` | `0x4bDbb3150014c6Ab2C6D9347B0779c49015a2f3f` | 8 | 86400 |
|---|---|---|---|---|
| NVDA | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | `0xCF169363636D73dbBf77733629CB38919d14232d` | 8 | 86400 |
| TSLA | `0x4A1166a659A55625345e9515b32adECea5547C38` | `0xE4479F01738B4e8C428CD8eB72D47AB9BC3c7de6` | 8 | 86400 |
| SGOV | `0xa0DF4ee0fFf975306345875E3548Fcc519577A11` | `0xa7a18Ca3F19E17FfA28F92302B817Ca8c1A94b06` | 8 | 86400 |

---

## 4. ERC-8056 interface (exact, on-chain verified)

**Sources:** RH `building-with-stock-tokens` **[docs]**, EIP-8056 (Draft) **[docs]**, and the
**verified implementation ABI** `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2` + **live logs**
**[onchain]**. Topic hashes computed with a self-tested keccak256
([`scripts/recon/keccak.py`](../scripts/recon/keccak.py); self-test matches the canonical ERC-20
`Transfer` topic).

**Multiplier conversion (verbatim [docs]):** `underlying shares = raw token amount × uiMultiplier ÷ 1e18`.
`uiMultiplier()` is 18-dec fixed point (`1e18 = 1.0`); at launch it is `1e18`.

**Deployed interface (present on the implementation ABI [onchain]):**

```solidity
// core
function uiMultiplier()   external view returns (uint256);   // selector 0xa60bf13d
// scheduled/pending change
function newUIMultiplier() external view returns (uint256);   // selector 0xdc767007
function effectiveAt()    external view returns (uint256);    // selector 0x97a4064f
// balances expressed in underlying shares
function balanceOfUI(address account) external view returns (uint256); // selector 0x437a9958
function totalSupplyUI()  external view returns (uint256);    // selector 0x9bea6429
// admin (emits UIMultiplierUpdated)
function updateMultiplier(...);
// NOTE: toUIAmount/fromUIAmount (EIP optional conversion iface) are NOT on this deployment.
```

**Events (exact signatures + topic0 [onchain]):**

| Event | topic0 |
|---|---|
| `Transfer(address indexed from, address indexed to, uint256 value)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| **`TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue)`** | **`0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802`** |
| **`UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)`** | **`0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055`** |

Also emitted by the token: `Approval`, `Paused`/`Unpaused`, `OraclePaused`/`OracleUnpaused`,
`MetaDataUpdated(string,string)`, `Initialized(uint64)`, `EIP712DomainChanged`; and `BeaconUpgraded`
on the proxy.

**Two facts that shape the indexer:**
1. **Every `Transfer` is paired 1:1 with a `TransferWithScaledUI` carrying `uiValue`** (the
   underlying-share value). Verified in live logs: over 4,000 blocks of AAPL, 478 `Transfer` ↔ 478
   `TransferWithScaledUI` (+16 `Approval`). **Index `TransferWithScaledUI` as the primary movement
   event** — you get raw (`value`) and underlying (`uiValue`) without recomputing, and it survives
   multiplier steps. **[onchain]**
2. **Naming: the deployed event is `TransferWithScaledUI`, NOT the EIP's canonical
   `TransferWithUIAmount`.** The EIP-8056 (Draft) canonical transfer event is
   `TransferWithUIAmount(...)` (topic `0x0226a2f5…`), which **does not appear on-chain**. The
   indexer must use `TransferWithScaledUI` / topic `0x37e7f0db…`. See §9. **[onchain]**

**Pipeline cross-check [onchain]:** AAPL `uiMultiplier()` on-chain = `1000566080061092436`
= the `/rhj/assets` `currentMultiplier` **exactly** — validates RPC, selector, address, and API
consistency in one shot.

---

## 5. ERC-8004 agent registry — **DEPLOYED**

Not referenced anywhere in the RH docs, but **live on-chain** (found via the standard ERC-8004
vanity addresses, then confirmed): **[onchain]**

| Registry | Proxy (ERC-1967) | Implementation (verified) |
|---|---|---|
| **Identity** | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `IdentityRegistryUpgradeable` `0x7274e874CA62410a93Bd8bf61c69d8045E399c02` |
| **Reputation** | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `ReputationRegistryUpgradeable` `0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34` |

- Identity registry is an **ERC-721 named "AgentIdentity" (symbol `AGENT`)** with **~44 holders**
  as of 2026-09-01 — real but early adoption. **[onchain]**
- Key ABI **[onchain]**:
  - `event Registered(uint256 indexed agentId, string agentURI, address indexed owner)`
  - `event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)`
  - `event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)` + ERC-721 `Transfer`/`Approval`
  - functions: `register` (3 overloads), **`getAgentWallet` / `setAgentWallet` / `unsetAgentWallet`**,
    `setAgentURI`, `getMetadata` / `setMetadata`, `ownerOf`, `balanceOf`, `isAuthorizedOrOwner`,
    `tokenURI`, `supportsInterface`.
- **Why this matters:** an agent mints an identity NFT and **binds one or more operating wallet
  addresses on-chain** (`setAgentWallet`). That gives a direct, standardized, on-chain
  identity → trading-wallet mapping — the anchor of the v1 agent universe (§8).
- **OPEN:** a third ERC-8004 registry (Validation) was not located at the checked pattern —
  confirm presence/address in Phase 1.

---

## 6. DEX venues & execution

Venues named in RH `building-with-stock-tokens` **[docs]**: **Uniswap** (AMM), **Rialto** (propAMM),
**Lighter** (orderbook; spot & perps). Details:

**Uniswap V3 — deployed on chain 4663.** Primary source: Uniswap's official deployments doc
(states chain ID 4663). Factory `getCode` = 24.5 KB (**live [onchain]**); the rest from the
deployments doc **[docs]**:

| Contract | Address |
|---|---|
| UniswapV3Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` **[onchain-verified]** |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |
| UniversalRouter | `0x8876789976decbfcbbbe364623c63652db8c0904` |
| NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` |
| TickLens | `0x7dfd4f31be6814d2906bde155c3e1b146eac1468` |
| UniswapInterfaceMulticall | `0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3` |
| NFTDescriptor | `0x2e9d45bb7b30549f5216813ada9a6b7982c5b3ed` |
| NonfungibleTokenPositionDescriptor | `0x6f84dae9c064ff453e5c8af51efb819f8f610225` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical) |

→ Standard v3: index `PoolCreated` (factory) + per-pool `Swap`/`Mint`/`Burn`. **Directly indexable.**

**Rialto (propAMM)** — market-maker-backed liquidity for stock tokens. **Router/pool/factory
addresses: OPEN.** No primary source located; a web-search candidate
`0x4ddf368080cd7946db5b459ad591c350158175e1` was **ruled out** (`eth_getCode` → no code on 4663).
**Not guessed.** Obtain from Rialto's own docs or on-chain discovery in Phase 1. **[onchain]**

**Lighter (orderbook, spot & perps)** — runs as a **ZkLighter zk-rollup**. Order matching,
positions, funding and liquidations happen **inside the rollup, not as RH-chain transactions**;
only **margin deposits/withdrawals** to the rollup contract are visible on RH chain. **[press]**
→ **Perp PnL is NOT reconstructable from RH-chain state alone** — only collateral flows are on-chain.
This bounds what the scoreboard can honestly claim about Lighter perp performance. Rollup contract
address: **OPEN** (only secondary sources so far). Resolve in Phase 1.

**Arcus** — listed in the brief, but **not found**: no mention in RH docs and no primary evidence of
a deployment on chain 4663. Treat as **not present** unless a primary source turns up. See §9.

**Account abstraction (execution path).** ERC-4337 EntryPoints are deployed: **v0.6**
`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`, **v0.7** `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
(`getCode` 32 KB, **live [onchain]**), **v0.8** `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`, plus
SenderCreators and a **Safe 4337 Module v0.3.0**. **[docs][onchain]** → many agents will trade as
**smart accounts**; their swaps surface as `UserOperationEvent` from the EntryPoint and the token
`Transfer`/pool `Swap` from the smart-account address. The `tx.origin` will often be a bundler, not
the agent — attribute by the account, not the origin.

---

## 7. Gas subsidy window

- **Mainnet launched 2026-07-01.** **[press]**
- **90-day gas fee waiver:** Robinhood covers gas for eligible users transacting via **Robinhood
  Wallet** (swaps, crypto & stock-token transactions, bridging), from launch through
  **≈ 2026-09-29**. **As of today (2026-09-01) it is ACTIVE — ~28 days left.** **[press]**
- The brief's "90-day waiver from ~1 July 2026" is **CONFIRMED**. Note the **technical
  `gas-and-fees` doc does not mention it** — it's a promotion documented in press / the Robinhood
  newsroom, not the dev docs. **[docs = silent; press = confirms]**
- Post-subsidy fee model: standard Arbitrum Nitro — **L2 execution fee + L1 data fee, paid in ETH**. **[docs]**

**Implications for metrics (important):**
1. **Regime change ≈ Sept 29.** During the waiver, subsidized users pay **~0 gas**, so "net of gas"
   ≈ gross for them **right now**. The engine must model the transition and must **not** extrapolate
   near-zero gas past the window. Track cost per-block/timestamp, not as a constant.
2. **The subsidy runs through Robinhood Wallet**, i.e. a **paymaster/sponsor** likely pays gas — so
   the on-chain fee payer may not be the agent's account. "Realised gas" must be read from
   receipts (`effectiveGasPrice × gasUsed`, and *who* actually paid), and attributed as the agent's
   economic cost only when the agent bore it. **OPEN:** identify the exact subsidy mechanism /
   paymaster address on-chain in Phase 1.

---

## 8. Identifying an agent address (research → v1)

Anchored on what actually exists on this chain (an on-chain ERC-8004 identity registry, ERC-4337
smart accounts, `us_equities_24/5` market hours).

| Approach | False positives | False negatives | Gameability | Verdict |
|---|---|---|---|---|
| **ERC-8004 Identity Registry** (index `Registered` + `setAgentWallet` → agentId → wallet[]) | Moderate — anyone can self-label, incl. humans | High early — only ~44 registered; misses undeclared agents | High — labels + wallet binding are self-asserted; Sybil / multi-ID / rotation | **Primary inclusion signal** |
| **Bytecode / AA fingerprints** (4337 accounts, Safe module, factory codehash) | High — most smart accounts are human-operated (RH Wallet included) | High — EOA-driven bots missed | Medium — switch to a plain EOA | **Secondary flag only** |
| **Behavioural heuristics** (periodicity, off-hours vs 24/5, inter-tx timing variance, gas-price patterns, router-only interaction) | High — active human day-traders / MM bots look automated | Medium — agents can mimic human cadence | High — jitter the timing | **Displayed signal, never gating** |
| **Project self-registration / attestation** (opt-in, signed) | Low if the binding is signature-verified | High — opt-in coverage | Low-Medium — false claims unless validated | **Optional precision add-on** |

**v1 recommendation — "declared, not detected."**
- **Universe = ERC-8004-declared agents.** Index the Identity registry: `Registered(agentId, …)`
  and `setAgentWallet` bindings → the candidate universe is the set of **bound wallet addresses,
  clustered under their `agentId`** (and under the `agentId` owner, to catch one operator holding
  many identities). Optionally accept a project self-registration that adds a **signed** attestation
  from the agent key for extra precision.
- **The leaderboard measures self-declared agents, and says so.** We do **not** claim to detect
  undeclared agents. This makes the error modes honest instead of hidden.
- **Behaviour + AA/bytecode are transparency flags only** — shown on the agent detail page
  ("periodicity score", "smart-account", "off-hours share"), **never** silently adding/removing an
  address. This avoids the high-FP, high-gameability failure of behaviour-based inclusion.
- **Survivorship at the identity level:** once an `agentId` (and its bound wallets) enters the
  universe it **never leaves** — not on deregistration, wallet rotation, or going to zero. Dedupe
  rotated wallets under the `agentId`.

**Error modes, stated plainly:**
- **Coverage bias (FN):** private/undeclared agents are never scored.
- **Label risk (FP):** "agent" is self-asserted; a human can register. Mitigate by requiring the
  bound wallet to have actually transacted, disclosing the operator address, and (optionally)
  a signed binding proof — but disclose that it remains self-asserted.
- **Sybil / rotation:** one operator may hold many `agentId`s or rotate wallets. Mitigate by
  clustering under the `agentId` owner and disclosing it; cannot fully eliminate.
- **Wallet-binding trust:** `setAgentWallet` is self-asserted; without a signature from the wallet
  key, an operator could bind a wallet they don't control. Prefer verified/attested bindings.
- **Transfer gating:** if `ACCESS_CONTROLLED_REGISTRY` (§2) restricts who can hold/move stock
  tokens, the agent-wallet population is implicitly filtered — verify in Phase 1.

---

## 9. Corrections (brief vs. verified reality)

1. **Chain ID 4663** — brief said "believed to be"; **confirmed on-chain** (`0x1237`). ✓
2. **Gas waiver (90 days from ~1 Jul 2026)** — **confirmed** (active now, ends ≈ Sept 29 2026), but
   documented only in press, **not** in the technical `gas-and-fees` doc.
3. **ERC-8004 registry** — brief left it open; **answer: YES, deployed** (Identity `0x8004A169…`,
   Reputation `0x8004BAa1…`). Not mentioned in RH docs.
4. **ERC-8056 interface** — the functions the brief listed (`uiMultiplier`, `balanceOfUI`,
   `totalSupplyUI`, `newUIMultiplier`, `effectiveAt`) **all exist** on the deployment, but they are
   **split across interfaces** in the standard (core `IScaledUIAmount` = `uiMultiplier` + 2 events;
   balances and pending-multiplier are extensions), not one flat interface.
5. **Event name** — the deployed transfer event is **`TransferWithScaledUI`** (topic `0x37e7f0db…`),
   **not** the EIP-8056 canonical **`TransferWithUIAmount`** (topic `0x0226a2f5…`, absent on-chain).
   The brief's name was right; index by `TransferWithScaledUI`. *(An early docs-summarizer read had
   merged/invented flat signatures and would have mis-set the interface; corrected against the
   verified on-chain ABI — exactly the reason the brief demanded primary sources.)*
6. **Oracle multiplier** — brief asked to confirm; **answer: the feed price already includes the
   multiplier** (total-return, per-raw-token, 8 decimals, SVR-enabled). Do **not** re-apply it.
7. **DEX venues** — Uniswap ✓ (V3, addresses verified), Rialto ✓ (named; **addresses unverified —
   OPEN**), Lighter ✓ (**but a zk-rollup: perps off-chain; only collateral flows on-chain**).
   **Arcus — not found** on chain 4663 / not in docs; treat as absent unless proven.
8. **Feed coverage** — **not every stock token has a Chainlink feed: only 35 of 194 do.** The
   remaining 159 need an alternative price source, which threatens the "exogenous-mid slippage"
   promise. The brief assumed universal feeds.
9. **Indexing** — Alchemy ✓; **"Allium" not found in docs (OPEN)**. Public RPC works for
   `eth_getLogs` (≥4k-block ranges) but **rate-limits (429)** under bursts.
10. **Token shape** — all 194 tokens are **BeaconProxies over one shared implementation**
    (`0xb354…5ae2`); they are **pausable**, have an **oracle pause**, `permit` (EIP-2612),
    admin `mint`/`burn`, and an **`ACCESS_CONTROLLED_REGISTRY`** (possible transfer permissioning).
    Not in the brief; relevant to indexing and to who may hold tokens.
11. **Genesis timestamp = 0** (Orbit artifact) — don't derive dates from chain genesis.

---

## 10. OPEN items to resolve before / during Phase 1

These are the "stop and ask / verify from primary source" items — **do not hardcode guesses**:

1. **Rialto** router/pool/factory addresses (propAMM). Source: Rialto docs or on-chain discovery.
2. **Lighter** rollup contract address + the exact deposit/withdraw event ABI (collateral flows only).
3. **Gas subsidy mechanism** — paymaster/sponsor address and eligibility, so "realised gas" is
   attributed correctly across the Sept-29 regime change.
4. **Pricing for the 159 feed-less tokens** — decide and disclose (RH `/rhj/prices/` vs DEX mid),
   and whether such tokens are scored at all in v1.
5. **`ACCESS_CONTROLLED_REGISTRY`** — does it gate stock-token transfers/holders (does it constrain
   which addresses — agents included — can hold/trade)?
6. **ERC-8004 Validation registry** — presence/address (only Identity + Reputation confirmed).
7. **ERC-8056 pending multiplier flow** — capture a real `UIMultiplierUpdated` with a future
   `effectiveAt` to test scheduled changes (none pending at snapshot).

---

## Reproduce this

- Read-only on-chain + API checks: [`scripts/recon/verify.sh`](../scripts/recon/verify.sh)
  (chain id, token decimals/`uiMultiplier` cross-check, event topics, ERC-8004 code, Uniswap
  factory code, feed decimals/`latestRoundData`).
- Topic-hash derivation (self-tested keccak256): [`scripts/recon/keccak.py`](../scripts/recon/keccak.py).
- Primary-source snapshots + sha256 provenance: [`docs/data/`](./data)
  ([`PROVENANCE.json`](./data/PROVENANCE.json), [`stock-tokens.csv`](./data/stock-tokens.csv),
  [`chainlink-feeds.csv`](./data/chainlink-feeds.csv), and the raw `*.raw.json`).

**Phase 0 ends here. Awaiting go-ahead before any application code (per the brief).**
