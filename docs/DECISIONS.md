# DECISIONS

A running log of non-obvious calls and their reasoning. Newest first.

## Phase 2 — findings and scope calls (2026-09-02)

### D-2.1 — RHMachines integration: NO
The unattributed-flow detector ranked RHMachines/`RHBTCAccount` as the #1 next venue
(30 of 34 unattributed movements). Declined: it would fix NAV coverage for a scoreable
population of **one**, and deposits carry no execution price, so it cannot improve slippage
measurement — the thing the scoreboard exists to do. Recorded as the ranked next integration
if the population ever justifies it. See [`BACKFILL.md`](./BACKFILL.md) §(e).

### D-2.2 — The AMM framing in the original brief was overstated; corrected
The brief warned that a multiplier step leaves every constant-product pool mispriced and LPs
arbitraged. Our own arithmetic, measured against every corporate action ever emitted on this
chain, disproves it: **≈0.124 bps for a 1% dividend, exactly zero for a compensated split**
(raw balances never rebase). The `erc8056` README now leads with that finding rather than a
warning, and labels the `r = 10` desynchronisation figure explicitly as a bound that has
never occurred, not a prediction. The real ERC-8056 hazard is share accounting, where errors
are whole multiples. Accuracy is the product; a scary-but-wrong framing would have cost more
than it bought.

### D-2.3 — `erc8056` on npm was already taken, six weeks before us
The unscoped name was published 2026-07-20 by `three-ws`
(`github.com/nirholas/robinhood-chain-erc8056`), describing itself as the "reference
implementation and canonical explainer" for ERC-8056 with Solidity + exact-bigint TypeScript.
The plan's "be the reference implementation before anyone notices" premise is therefore
**already false**. Our differentiation is narrower and empirical: real on-chain fixtures, the
measured AMM result above, 100% conversion-path coverage, and MIT. Publishing decision and
final package name deferred to the owner.

### D-2.4 — Workspace scope renamed `@rhchain/*` → `@assayhq/*`
`@rhchain` was a placeholder scope we do not own; `@assayhq` is owned and is where
`erc8056` was published. The three workspace-internal packages (`indexer`, `metrics`, `web`)
were renamed to match, atomically across manifests, imports, `--filter` flags, docs and the
lockfile, so the repository carries one scope. **Note on the original premise:** the
`pnpm --filter @rhchain/metrics recompute` command in the README was not broken — that was
the live package name — so this is a consistency rename, not a bug fix. All three are now
marked `"private": true`, because renaming into a scope we *do* own turns a would-be 403 on
an accidental `publish` into a real publish. Only `packages/erc8056` is publishable.

### D-2.5 — Repository is Apache-2.0; `packages/erc8056` stays MIT
Root `LICENSE` is the verbatim Apache-2.0 text, with the appendix copyright filled in as
**Muslim Oskanov, 2026** at the owner's direction. `packages/erc8056` keeps its own MIT
`LICENSE` and `"license": "MIT"`, so it can be vendored without Apache-2.0's attribution and
NOTICE requirements. The carve-out is machine-readable from the package manifest and stated in
both READMEs.

### D-2.6 — `UIMultiplierUpdated` is re-emitted; the strict chain check stays strict
Two of the 17 corporate-action logs on this chain are repeats, not distinct actions: CRWD's
4:1 split is logged at blocks 978,630 *and* 1,231,096 with identical `oldMultiplier`,
`newMultiplier` and `effectiveAt`, and one unlisted token repeats an update the same way.
Fed the raw per-token log stream, `MultiplierHistory.fromEvents()` throws `chain broken`
rather than ignoring the repeat. Decision: **document it, do not loosen the check.** Silently
accepting a mismatched old→new chain is exactly the failure mode that mis-values a position by
a whole multiple. Callers collapse repeats per token before building a history, and 0.1.2
ships that pass as the exported `dedupeMultiplierEvents()` — ten lines, opt-in, keyed on all
three fields (`oldMultiplier`, `newMultiplier`, `effectiveAt`) so two genuinely different
actions can never be merged, a corrected schedule reusing an `effectiveAt` included.
`fromEvents()` is unchanged and still throws; only its error message gained a pointer to the
helper. Tests pin both halves against the real fixture: the raw stream throws for exactly the
two repeating tokens, the deduped stream for none.

### D-2.7 — Holder balances read from the explorer index, not replayed from logs
Reconstructing current balances from `Transfer` / `TransferWithScaledUI` is still impossible
(>50M movements; a full-range topic query returns `log query timed out`). Blockscout's
`/api/v2/tokens/{t}/holders` is exact, already net of every movement, strictly
value-descending, and carries `is_contract` per row — so it was used instead, and all 193
indexed tokens were enumerated completely (919,694 positions, nothing sampled). Two traps are
recorded because either one silently corrupts the result: the legacy `/api` endpoint bans for
hours after a few hundred requests while `/api/v2` sustains 8.7 req/s, and **a soft rate limit
arrives as HTTP 200 with `{"status":"0"}`**, which parses as an empty page and truncates a
holder list. No token is accepted unless its row count matches the declared `holders_count`.

### D-2.8 — `token0()` is not a sufficient venue test on this chain
The brief specified excluding "contracts answering `token0()`". That misses **Uniswap V4,
which keeps every pool's liquidity in one singleton `PoolManager`** with no `token0()` — and
that contract is the single largest Stock Token holder on the chain ($25.5M, 192 of 194
tokens). It also misses Lighter's `ZkLighter` proxy and V4 hooks. Detection now unions
`token0()` responders, `poolManager()` responders and verified venue names. Using the brief's
test alone would have misattributed **$32M of venue liquidity to customers** and reported the
top holder as a whale. Three large unverified contracts ($6.7M) remain unidentified and are
deliberately **not** excluded.

### D-2.9 — Blockscout `is_contract` overstates contracts; EIP-7702 wallets are users
`is_contract` marks 52% of holders as contracts. Sampling the bytecode shows the dominant
"contract" is 23 bytes beginning `0xef0100` — an **EIP-7702 delegation designator**, i.e. an
ordinary EOA delegated to a smart account (`Simple7702Account`, MetaMask's
`EIP7702StatelessDeleGator`, Alchemy's `SemiModularAccount7702`, all verified). Classification
is therefore three-way and RPC-derived, not label-derived: ~75% of the base is a user wallet.
The label also has ~6% false negatives (3 of 50 sampled `is_contract=0` addresses had
bytecode), so it is not trusted in either direction.

### D-2.10 — Correcting our own framing: we measured a thin slice, not a thin chain
Four documents measured ERC-8004 agents and Stock Tokens on chain 4663, found almost nothing,
and framed it as a verdict on the venue. Independent measurement of protocol fee data (DefiLlama,
2,649 protocols, per-chain `breakdown30d`) shows Robinhood Chain earning **$157.9M/30d across 121
protocols — the #4 chain in crypto** — on **$19.2B** of DEX volume, at a 0.67–1.02% fee/volume
ratio. Composition is memecoin launchpads ($46.9M) and DEX trading ($75.1M), not equities. On
Blockscout, the memecoin CASHCAT ($267M, 104,221 holders) is worth 21x the largest Stock Token.
The original measurements are unchanged and correct; the inference drawn from them was not.
Recorded as [`CHAIN_SCALE.md`](./CHAIN_SCALE.md) rather than by editing the dated documents, and
paired with a falsifiable prediction for the 29 Sept subsidy expiry (>70% fee decline within two
weeks = farming). Lesson, and the reason this is a decision rather than a footnote: **exhaustive
measurement of the wrong denominator is still the wrong answer**, and we caught it only by
measuring where the money was rather than where the thesis pointed.

### D-2.11 — The sampled detector's blind spot is quantified, not hedged
Every unregistered-address count in `MARKET_SIZE.md` came from 16 windows of 400 blocks over
40M blocks, and the document said only that infrequent addresses "can be missed". Asked how we
could possibly see an agent someone runs from home, the honest answer is that we mostly cannot,
and the size of that gap is computable from the sampling constants themselves: 16 x 40s of
observation over 46 days is **0.016% of the period**, and detection requires landing in >= 3
windows, so P(detected) is a binomial upper tail. Even odds begin at **~353 trades/day**,
reliable detection at **~743/day**; ten trades a day is a 1-in-10,000 shot. Recorded as
[`scripts/snapshot/detection_floor.py`](../scripts/snapshot/detection_floor.py), which derives
the curve from the same constants so it cannot drift from the sampler, and stated in
`MARKET_SIZE.md` §2 and §4 and in the README lead. Two things deliberately **not** done:
the sampling constants were not widened (that changes what the committed 2026-09-02 baseline
compares against), and the finding was not softened into "the population may be larger, so the
scoreboard may work". It cuts the other way — an agent that cannot be identified cannot be
benchmarked, so undetected agents make the product harder, not easier. The uniform-arrival
model is also optimistic: measured flow has a median inter-event CV of 2.14, and bursty
activity of the same daily volume clusters into fewer intervals, so the real floor is higher
than these numbers.

### D-2.12 — CVE-2026-39356: real, unreachable here, patched anyway; `ws` overridden not upgraded
An unsolicited issue (wraithioner/assayhq#1, from an automated scanner) reported
[CVE-2026-39356](https://github.com/advisories/GHSA-gpj5-g38j-94v9) — HIGH, CWE-89, SQL
injection via unescaped identifier delimiters in `drizzle-orm < 0.45.2`. Verified against the
GitHub advisory database and NVD, and reproduced independently with `pnpm audit`: the advisory
is genuine and 0.36.4 was in range.

**It was not exploitable here.** The advisory only applies where untrusted runtime input
reaches identifier or alias construction. This repo has no `sql.identifier()`, no `sql.raw()`,
no dynamic `.as()`; every `orderBy` takes a static schema object, and the indexer is a local
CLI with no HTTP surface. The issue's own patch was also wrong for this repo — it edited a
`dependencies` block in the root `package.json`, which does not exist (the package lives in
`packages/indexer`). Upgraded regardless: an unexploitable HIGH is still a HIGH the next
reader has to re-derive.

Six advisories were cleared at once, since the tree had five the issue never mentioned,
including two criticals:

| package | from | to | why |
|---|---|---|---|
| `drizzle-orm` (prod) | 0.36.4 | 0.45.2 | CVE-2026-39356; 0.45.2 is the only fixed 0.x |
| `ws` (prod, via `viem`) | 8.18.0 | 8.21.3 | GHSA high + moderate |
| `vitest` (dev) | 2.1.8 | 3.2.7 | two criticals (RCE, arbitrary file read) |
| `vite` (dev, via `vitest`) | 5.4.21 | 6.4.3 | high + two moderates |
| `esbuild` (dev) | 0.21.5 / 0.23.1 | 0.25.12 / 0.28.2 | moderate |
| `tsx` (dev) | 4.19.2 | 4.23.13 | carries the patched esbuild |

Three calls worth recording:

**`ws` is overridden, not fixed by upgrading `viem`.** `viem@2.21.55` pins `ws` at exactly
`8.18.0`, so the only ways to move it are a `pnpm.overrides` entry or a viem upgrade. Viem was
left alone deliberately: it is the one production dependency that talks to the chain, and every
published measurement in `MARKET_SIZE.md`, `HOLDER_BASE.md` and `CHAIN_SCALE.md` was produced
with 2.21.55. Thirty-five minor versions of churn in the RPC layer, to fix an advisory in a
module this codebase never loads (the indexer uses `http()` transport only, never
`webSocket()`), is a worse trade than one pinned override. `8.21.3` is the same `ws` major that
upstream viem itself now ships.

**`vite` needed an override too.** `vitest@3.2.7` accepts `vite ^5 || ^6 || ^7`, so pnpm kept
the `5.4.21` already in the tree and the vite advisories survived the vitest bump. vite 5.x
tops out *inside* the vulnerable range (`<=6.4.2`) and pins `esbuild ^0.21.3`, so no 5.x
release can be clean — 6.4.3 is the floor, not a preference.

**vitest 3.2.7, not 4 or 5.** The advisory floor is 3.2.6. The tests are this repo's proof of
correctness, so the smallest jump that clears it wins over `latest` (5.0.0, three majors away).

Verified after: `pnpm audit` reports **0 advisories** in both the full and `--prod` trees,
`pnpm -r typecheck` clean, all **94 tests** pass, `erc8056` coverage still 100% on all four
axes, `next build` succeeds, and `packages/erc8056/dist` is still byte-identical to the
published 0.1.2 tarball (TypeScript is unchanged at 5.6.3), so the `CHANGELOG.md` provenance
claim survives. Drizzle's deprecated object-form table-extras callback — `(t) => ({ ... })`,
used in eight places in `schema.ts` — still typechecks on 0.45.2; the changelogs 0.37→0.45
record no removal, only a types-only breaking change to MySQL/PostgreSQL column builders that
this SQLite schema does not touch.

## Phase 1 — build (2026-09-01)

Approved scope constraints (from the go-ahead): score **only the 35 feed-covered tokens**
(no RH price API — breaks recomputability; no DEX mid — endogenous); majority-feedless agents
are **unscoreable**, never partially scored. **Uniswap V3 only**; build an **unattributed-flow
detector** (balance change with no matching indexed swap) that excludes those agents and ranks
which venue to add next. **ERC-8004 self-declared = scoring universe**, heuristics display-only;
**scoring starts at the registration block, never backfilled**; pre-registration history displays
as `unverified` and is excluded from aggregates; entry-selection bias surfaced in the UI.

### D-1.1 — Monorepo: pnpm workspaces, ship TS source (no build step)
Packages export `src/*.ts` directly (`main`/`types` point at source); consumers use a bundler
(vite/tsx/Next). Reason: fewer moving parts for a data-correctness project; the indexer/metrics/web
import the same source the tests exercise, so there's no compiled artifact to drift.

### D-1.2 — `packages/erc8056` first, as the executable spec
The conversion math ships as **twin implementations** — TypeScript and `ScaledUIMath.sol` — that
floor identically; the **TS property tests are the shared spec**. Reason: the on-chain and off-chain
numbers must agree to the wei or NAV/slippage diverge; one spec, two conformant implementations.

### D-1.3 — NAV has exactly one, multiplier-free implementation
`rawBalanceValueUsd` takes **no** multiplier argument (the feed is total-return; §D-0.6). A property
test pins that valuation is independent of the multiplier, and a concrete test shows double-applying
it overstates NAV 4× on a CRWD-style 4.0 multiplier. Reason: make the most likely accounting bug
structurally impossible, not just discouraged.

### D-1.4 — AMM/multiplier analysis: splits are a non-event, dividends are the (small) hazard
Because raw balances never rebase and the feed is total-return, a constant-product pool is immune to
splits; the only LP loss is the ~`(√r−1)²/2` arbitrage during the window between a reinvested
dividend's on-chain `effectiveAt` and the feed re-aligning (≈0.0012% for 1%). Consequence encoded
downstream: slippage is measured vs the **Chainlink mid**, and fills inside a multiplier-step window
are flagged. (Full derivation in `packages/erc8056/README.md`.)

### D-1.5 — Store raw events keyed by (txHash, logIndex); derive nothing in the indexer
SQLite + Drizzle; every event table upserts `onConflictDoNothing` on
`(tx_hash, log_index)`. Reason: idempotent re-runs, clean reorg rollback by block, and a
single auditable store the metrics layer recomputes from — recomputability over convenience.

### D-1.6 — Discover Uniswap pools by `factory.getPool`, not by scanning `PoolCreated`
Pools were created at launch (~51M blocks ago); a call-based lookup is a handful of `eth_call`s
vs thousands of `getLogs` chunks against a rate-limited public RPC. Trade-off: `created_block`
is unknown (0) for call-found pools, which doesn't affect swap indexing. Validated live: 5 AAPL
pools found, 22 real swaps decoded.

### D-1.7 — Prices from Chainlink `AnswerUpdated` logs + `priceAsOf`, never the RH price API
The feed emits `AnswerUpdated` (~24h heartbeat, sparse); NAV uses the last answer at-or-before a
timestamp. Reason: fully recomputable from chain logs (the go-ahead banned the off-chain RH price
API). Confirmed the event fires on the AAPL aggregator with the expected value.

### D-1.8 — Agent identity = verified `agentWallet` metadata history (correction)
The earlier owner-as-wallet decision was wrong. The deployed ERC-8004 implementation emits
`MetadataSet(agentId, …, metadataKey, metadataValue)` when `setAgentWallet` succeeds; for the
`agentWallet` key the value is the packed, proof-verified address. v1 decodes that event into a
point-in-time binding history and treats NFT ownership only as registry control. A wallet is scored
only while bound and never before registration. Reason: this is both cryptographically stronger and
fully log-recomputable; assuming the NFT owner trades would create silent false attribution.

### D-1.9 — Unattributed-flow detector + coverage gate, exactly as directed
A stock-token move is matched only to a same-tx, same-token Uniswap swap with a unique pool/amount
or otherwise unambiguous candidate; multiple indistinguishable swaps are explicitly `ambiguous`,
not guessed. Unmatched and ambiguous flow is excluded from execution scoring and aggregated by
token to rank the next venue. Majority-feedless agents are unscoreable, never partial. Unknown,
unpriced flow also makes coverage unscoreable rather than disappearing from the denominator.

### D-1.10 — Index canonical emitters once; attach agents point-in-time downstream
The indexer accepts `TransferWithScaledUI` only from the issuer-published 194-address allowlist and
stores each `(txHash, logIndex)` once, even when both endpoints are agent wallets. Agent direction
and identity are point-in-time joins against `agent_wallet_history`, not duplicated columns on the
raw event. Reason: duplicated endpoint rows corrupt volume/NAV, while storing today's owner on a
historical event breaks recomputability after wallet rotation.

### D-1.11 — Reorg recovery persists the rollback before replay
The follower indexes only through `head - reorgBuffer`. On a stored-tip mismatch it rechecks all
stored event/checkpoint headers inside the buffer, rolls raw tables back to the highest canonical
match, and **writes that rollback cursor before** replaying. If the oldest checkpoint also differs,
it stops with a resync-required error. Reason: replaying after a deep, unproven ancestor silently
mixes forks; persisting the rollback first also makes a crash during replay safely resumable.

### D-1.12 — Proxy snapshots are authoritative; every quote has its own USD feed
Metrics will use `latestRoundData` read from the Chainlink **proxy** at each agent event block plus
an aligned 36,000-block cadence. This remains correct across aggregator upgrades; raw
`AnswerUpdated` logs are retained as audit evidence, not the scoring source. Both USDG and WETH are
converted through their point-in-time USD feeds, and ETH/USD is captured at every agent event block
for gas. Reason: assuming USDG=$1 hides depegs, while treating WETH units as dollars is a catastrophic
but superficially plausible execution-price bug.

### D-1.13 — Score a covered subportfolio with explicit cash-flow boundaries
NAV contains the 35 feed-covered Stock Tokens plus USDG/WETH. Matched feed-less trades remain in
the flow-coverage denominator, but their realized quote leg is treated as a scoped withdrawal/buy
or contribution/sell so an unpriceable holding does not masquerade as a covered-portfolio loss or
gain. Returns are time-weighted across external cash flows and wallet-binding segments. Any
unattributed/ambiguous stock flow, mismatched stock/cash swap leg, overlapping agent-wallet binding,
or missing point-in-time fact makes the score unpublishable. Reason: a narrower honest score is
preferable to a numerically complete score with hidden balance-sheet holes.

### D-1.14 — Net holdings already contain slippage; gas is direct-payer only
Actual post-trade balances already embody execution slippage. Net P&L therefore uses actual NAV and
subtracts only gas paid by a transaction whose sender is the bound wallet; gross P&L adds both that
gas and signed adverse slippage back once. Bundler/paymaster gas is reported as unassigned, not
charged. The default benchmark is explicitly `inferred: SPY`; no off-chain mandate is fetched.
Reason: subtracting slippage again double-counts it, while pretending a receipt sender identifies an
ERC-4337 economic payer invents a cost the chain data does not prove.

### D-1.15 — Recompute is local, read-only, and pinned to a block
`@assayhq/metrics` opens an existing SQLite index in read-only mode and emits fixed-point USD fields
plus ratios as JSON. A regression test changes future snapshots and proves that a block-pinned score
does not move; another keeps an ERC-8004 registrant with no wallet/trades in the output. Reason:
point-in-time and survivorship are product guarantees, so both need executable failure tests rather
than prose conventions.

### D-1.16 — The website is a static view of an explicit, versioned snapshot
The Next.js app has no runtime RPC, wallet connection, sign-in, or server action. A separate command
opens the SQLite index read-only, runs the same metrics engine as the recompute CLI, and writes a
versioned JSON snapshot before static export. The committed snapshot is empty and produces an honest
empty state; no demonstration agents or plausible-looking performance figures are seeded. Scoreable,
unscoreable, and inactive registrants share the same dataset and detail-page model. Reason: a static
artifact keeps every displayed number tied to a known evaluation block while preserving survivorship
and avoiding a second, browser-only scoring implementation.

## Phase 0 — recon (2026-09-01)

### D-0.1 — Primary sources are read from raw HTML / on-chain, not via a summarizer
An early automated read of the docs **hallucinated** ERC-8056 function signatures (merged
`balanceOfUI`/`newUIMultiplier`/`effectiveAt` into one flat interface with invented return shapes).
Decision: treat any prose-summarizer output as a lead only; establish every load-bearing fact from
**raw SSR HTML** (`curl`), the **verified on-chain ABI**, or a **machine-readable API**. The chain is
the source of record when a doc disagrees. Reason: the brief's core value is measurement integrity;
a wrong event name or interface silently corrupts the index.

### D-0.2 — On-chain verification is authoritative over both the brief and the docs
Resolved the `TransferWithScaledUI` vs EIP-canonical `TransferWithUIAmount` naming conflict by
reading the **verified implementation ABI** (all tokens are BeaconProxies over one impl,
`0xb354…5ae2`) and confirming against **live logs** (478 `Transfer` ↔ 478 `TransferWithScaledUI`).
The indexer keys on `TransferWithScaledUI` / topic `0x37e7f0db…`. Reason: only the emitted event
matters to an indexer; specs and docs are secondary to what the contract actually logs.

### D-0.3 — Never hardcode an unverified address; mark it OPEN
The Rialto propAMM router had only a secondary-source candidate
(`0x4ddf…175e1`); `eth_getCode` showed **no code** on chain 4663, so it was rejected, not recorded.
Rialto and Lighter addresses are left **OPEN** for Phase 1. Reason: the working agreement — "never
guess an address; if you can't verify from a primary source, stop and ask."

### D-0.4 — Commit primary-source snapshots with sha256 provenance
The token list (`/rhj/assets`) and Chainlink feed directory are loaded dynamically by their
respective sites; both are committed **as fetched** under `docs/data/*.raw.json` with sha256 +
timestamp in `PROVENANCE.json`, alongside normalized CSVs. Reason: the brief requires every number
to be third-party-recomputable; snapshotting the raw responses makes the recon auditable and the
derived tables regenerable.

### D-0.5 — `TransferWithScaledUI.uiValue` is the movement primitive
Because every transfer emits both `value` (raw) and `uiValue` (underlying shares), and the pairing
holds across multiplier steps, the indexer should record `TransferWithScaledUI` as the canonical
movement event rather than deriving underlying shares from `Transfer` + a separately tracked
multiplier. Reason: fewer moving parts, no off-by-one at the block where a multiplier changes.

### D-0.6 — NAV uses the raw balance × Chainlink answer; no `uiMultiplier` re-application
The RH and Chainlink docs both state the feed already returns the **total-return, multiplier-adjusted
price per raw token** (8 decimals, SVR-enabled). So `usd = rawBalance/1e18 × answer/1e8`. The
ERC-8056 conversion is reserved for **share accounting**, not USD NAV. Reason: double-applying the
multiplier is the obvious trap here; documented so Phase 1 doesn't fall into it.

### D-0.7 — Agent universe = ERC-8004-declared, "declared not detected"
An on-chain ERC-8004 Identity registry ("AgentIdentity", ~44 holders, with `setAgentWallet`
binding) exists. v1 uses it as the **inclusion signal**; behaviour/bytecode heuristics are
**display-only flags**, never gating. Reason: behaviour-based inclusion has unacceptable
false-positive and gameability rates; scoring a well-defined self-declared population keeps the
error modes honest, which is the whole thesis.

### D-0.8 — Flag the 35/194 feed-coverage gap as a scoring risk, not a footnote
Only 35 of 194 tokens have a Chainlink total-return feed. Slippage-vs-exogenous-mid can't be done
for the other 159 without an off-chain or endogenous price. Recorded as an **OPEN** decision for
Phase 1 (which tokens are scorable, and with what price source) rather than silently substituting a
pool mid. Reason: the brief's promise is "slippage vs the Chainlink mid, not the pool price."

### D-0.9 — Recon tooling ≠ application code
`scripts/recon/` (verify.sh, keccak.py) and `docs/` are recon/verification artifacts, explicitly
**not** the Phase 1 packages (`packages/erc8056`, `packages/indexer`, `packages/metrics`,
`apps/web`). No application code was written; Phase 0 stops here pending go-ahead. Reason: the brief
says stop after Phase 0 and wait.
