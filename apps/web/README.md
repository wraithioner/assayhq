# Agent Scoreboard web

A static Next.js presentation of `@assayhq/metrics` output. There is no login,
wallet connection, RPC call, server action, or write transaction in the app.

The committed `data/scoreboard.json` is intentionally empty. The UI says so
plainly instead of shipping invented agents. Export a real snapshot from an
indexed SQLite database before building:

```bash
INDEX_DB=/absolute/path/index.sqlite pnpm --filter @assayhq/web export:data
pnpm --filter @assayhq/web build
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
pnpm --filter @assayhq/web typecheck
pnpm --filter @assayhq/web test
pnpm --filter @assayhq/web build
```
