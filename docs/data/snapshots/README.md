# Subsidy comparison snapshots

The 90-day gas-fee waiver ends ~29 September 2026. These snapshots bracket it.

- `2026-09-02-pre-subsidy-end.json` — baseline, head block 52,527,642.
- After 30 September, run:

```bash
python3 scripts/snapshot/subsidy_snapshot.py --out docs/data/snapshots/2026-09-30-post-subsidy-end.json
python3 scripts/snapshot/subsidy_snapshot.py --diff \
  docs/data/snapshots/2026-09-02-pre-subsidy-end.json \
  docs/data/snapshots/2026-09-30-post-subsidy-end.json
```

The sampling parameters in the script are fixed constants; do not change them between runs or
the diff is meaningless. Kill criterion from the build plan: agent activity down >70% means
the agent economy was rented.
