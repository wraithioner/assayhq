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
