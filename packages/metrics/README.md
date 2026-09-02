# @assayhq/metrics

Recomputes agent performance from the indexer's raw SQLite tables. It never
calls an RPC or off-chain price API and opens the database read-only.

## Accounting scope

- The survivorship universe is every ERC-8004 registration. No agent row is
  dropped because its wallet is later cleared or its NAV reaches zero.
- Activity belongs to an agent only while its proof-verified `agentWallet`
  binding is active, at exact block/log ordering. Scoring never starts before
  registration.
- NAV contains the 35 feed-covered Stock Tokens plus USDG and WETH. The
  Chainlink stock feeds already include the ERC-8056 multiplier, so NAV never
  applies it again. Native ETH is excluded from NAV and called out in output.
- Feed-less matched trades remain in the coverage denominator. Their quote leg
  is neutralized as an external flow so the covered subportfolio is not charged
  for an asset it cannot value. Majority feed-less flow is unscoreable.
- Any stock movement that is unattributed or ambiguously attributed is
  unscoreable; the engine does not guess a venue or fill.

## Returns and costs

For each verified wallet-binding segment, the engine values balances at the
binding boundary and every complete fixed-cadence price block. Period return is
Modified-Dietz-like:

```text
net P&L = ending NAV - starting NAV - external cash flows - direct-payer gas
net return = net P&L / (starting NAV + time-weighted external flows)
gross return = (net P&L + gas + adverse slippage) / denominator
```

Real holdings already contain execution slippage, so slippage is added back
only for the gross counterfactual; it is not subtracted twice. Gas is charged
only when the transaction sender equals the bound agent wallet. Bundler or
paymaster receipts are published as unassigned gas rather than falsely charged.

The benchmark defaults to the SPY total-return feed and is explicitly labelled
`inferred`. Sharpe and information ratio use the observed point-in-time periods
with zero risk-free rate. Capacity decay is the OLS slope of adverse slippage
bps against `log10(trade USD)` and stays null below three fills.

## Recompute

```bash
# one agent, at the latest fully priced cadence
pnpm --filter @assayhq/metrics recompute --db data.sqlite --agent 42

# pin the exact published block
pnpm --filter @assayhq/metrics recompute --db data.sqlite --agent 42 --block 51840000

# every registered agent, including unscoreable/dead entries
pnpm --filter @assayhq/metrics recompute --db data.sqlite
```

All fixed-point USD fields are decimal strings with 8 decimals. Ratios are JSON
numbers. The output includes its schema version, chain ID, evaluation block,
coverage, exclusions, and the exact recompute command shown by the web app.
