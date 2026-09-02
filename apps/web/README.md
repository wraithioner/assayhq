# Agent Scoreboard web

A static Next.js presentation of `@rhchain/metrics` output. There is no login,
wallet connection, RPC call, server action, or write transaction in the app.

The committed `data/scoreboard.json` is intentionally empty. The UI says so
plainly instead of shipping invented agents. Export a real snapshot from an
indexed SQLite database before building:

```bash
INDEX_DB=/absolute/path/index.sqlite pnpm --filter @rhchain/web export:data
pnpm --filter @rhchain/web build
```

The exporter opens the index read-only and writes the versioned metrics JSON.
`next build` uses `output: "export"`; deploy the resulting `apps/web/out/`
directory to any static host.

Routes:

- `/` — sortable leaderboard with unscoreable rows retained.
- `/agents/:agentId` — NAV curve vs SPY, metrics, costs, coverage, exclusions,
  and the block-pinned recompute command.

Local checks:

```bash
pnpm --filter @rhchain/web typecheck
pnpm --filter @rhchain/web test
pnpm --filter @rhchain/web build
```
