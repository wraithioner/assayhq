# @rhchain/indexer

A reorg-safe, idempotent, resumable indexer for Robinhood Chain. It stores **raw
events** into SQLite and derives nothing itself — `@rhchain/metrics` computes NAV,
returns, costs and slippage from these tables so that every published number is
recomputable from raw chain state.

Addresses come from [`config/robinhood-mainnet.json`](./config/robinhood-mainnet.json),
generated from the primary-source-verified [`/docs/RECON.md`](../../docs/RECON.md).

## What it captures

| Stream | Source | Table |
|---|---|---|
| Agent identities, controllers, and verified trading-wallet bindings | ERC-8004 `Registered`, NFT `Transfer`, `MetadataSet(agentWallet)` | `agents`, `agent_owner_history`, `agent_wallet_history` |
| Stock-token moves touching an agent | `TransferWithScaledUI` (raw `value` + `uiValue`) | `token_transfers` |
| Uniswap V3 executions | pool `Swap` (pools found by `factory.getPool`) | `swaps`, `uni_pools` |
| Corporate actions | `UIMultiplierUpdated` | `multiplier_updates` |
| Price audit stream | Chainlink `AnswerUpdated` on each feed's aggregator | `price_updates` |
| Scoring prices | Proxy `latestRoundData` at event + fixed cadence blocks | `price_snapshots` |
| Gas | tx receipts for agent txs | `tx_gas` |
| Block headers (reorg + timestamps) | `eth_getBlock` | `blocks` |

## Design guarantees

- **Idempotent** — every event row is `onConflictDoNothing` on `(tx_hash, log_index)`;
  re-running any range changes nothing.
- **Resumable** — progress is a cursor in `indexer_state`.
- **Reorg-aware** — `syncOnce` rechecks the stored tip; on mismatch,
  `findCommonAncestor` locates the highest canonical buffered checkpoint,
  `rollbackAbove` removes orphaned events, and the rollback cursor is persisted
  before replay. Deeper-than-buffer reorgs fail closed.
- **Point-in-time** — prices are a sparse `AnswerUpdated` series; NAV uses
  `priceAsOf(t)` = the last answer at-or-before `t`, never a future one.

The correctness-critical logic is unit-tested without network access: identity history, reorg
(`reorg.ts`), attribution + coverage (`attribution.ts`), pricing + slippage
(`pricing.ts`), plus SQLite integration tests for sync/rollback and Chainlink
snapshot scheduling. Run `pnpm --filter @rhchain/indexer test` (31 tests).

## Scoring-relevant policy (from the go-ahead)

- **Scoreable universe = the 35 feed-covered tokens.** `token_transfers.scoreable`
  flags each move; agents whose flow is majority feed-less are classified
  **unscoreable** by `classifyAgentCoverage` (never partially scored).
- **Uniswap V3 only.** A stock-token move with no Uniswap swap in the same tx is
  **unattributed flow** — excluded from execution scoring and, aggregated by token,
  it ranks which venue (Rialto/Lighter/…) to integrate next.
- **Identity is log-derivable.** The scored wallet comes from proof-verified
  `agentWallet` metadata emitted by ERC-8004. NFT ownership is registry control,
  not assumed trading activity. Wallet association is resolved point-in-time.
- **Every quote is feed-normalized.** USDG/USD and ETH/USD snapshots are used at
  the execution block; neither a hard stablecoin peg nor WETH-as-USD is assumed.

## Validated against mainnet

`pnpm --filter @rhchain/indexer smoke` (network-dependent) ran on 2026-09-01:
discovered **5 AAPL/Uniswap pools** by call and indexed **22 real swaps** in a
1,500-block window (sample: ~0.094 AAPL for 29.8 USDG ≈ **$316/AAPL**, matching the
Chainlink answer). `AnswerUpdated` events were confirmed on the AAPL aggregator
(`answer $315.71`, roundId 527) — sparse (~24h heartbeat), which is exactly what a
point-in-time "last answer ≤ t" lookup wants. USDG is 6-decimals (confirmed via the
swap ratio).

## Usage

```bash
# discover Uniswap pools for all canonical Stock Tokens (call-based)
tsx src/cli.ts discover-pools --db data.sqlite

# index a finalized block range (idempotent; re-runnable)
RH_RPC=<alchemy-url> tsx src/cli.ts backfill --db data.sqlite --from 51000000 --to 51010000

tsx src/cli.ts stats --db data.sqlite

# one safe finalized-head advance, then continuous following
RH_RPC=<alchemy-url> tsx src/cli.ts sync --db data.sqlite --start <verified-start-block>
RH_RPC=<alchemy-url> tsx src/cli.ts follow --db data.sqlite --poll-ms 5000
```

## Honest v1 scope / known gaps

- **Full historical backfill needs an archive RPC.** The chain is at ~51.6M blocks;
  the public RPC rate-limits (HTTP 429) and isn't archival. Point `RH_RPC` at
  Alchemy and backfill launch→tip in ranges. The smoke deliberately scopes to a
  small recent window + one token.
- **Unbound agents have no scored wallet.** ERC-8004 registration defines the
  survivorship universe, but an agent contributes scored activity only after a
  verified `agentWallet` binding. Clearing or rotating the binding takes effect at
  that event's exact block/log position.
- **Pool discovery uses `factory.getPool`** (single calls) rather than scanning
  `PoolCreated`; `uni_pools.created_block` is therefore 0 (unknown) for call-found
  pools. It doesn't affect swap indexing.
- **`tx_from` is not claimed to be the economic fee payer.** For ERC-4337 flows it
  can be the bundler; the subsidy/paymaster attribution is resolved in
  `@rhchain/metrics` rather than silently charging the agent.
- **Historical snapshots require archive reads.** `latestRoundData` is called at
  explicit historical blocks; a non-archive RPC must fail rather than substitute
  today's answer.
