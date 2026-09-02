# DECISIONS

A running log of non-obvious calls and their reasoning. Newest first.

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
`@rhchain/metrics` opens an existing SQLite index in read-only mode and emits fixed-point USD fields
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
