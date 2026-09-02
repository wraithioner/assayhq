#!/usr/bin/env -S npx tsx
/**
 * rh-index — a small CLI around the indexer.
 *
 *   tsx src/cli.ts backfill --db data.sqlite --from <block> --to <block>
 *   tsx src/cli.ts sync --db data.sqlite --start <block>
 *   tsx src/cli.ts follow --db data.sqlite --start <block> --poll-ms 5000
 *   tsx src/cli.ts discover-pools --db data.sqlite
 *   tsx src/cli.ts stats --db data.sqlite
 *
 * `backfill` indexes a fixed finalized range in chunks. Re-running the same
 * range is a no-op (idempotent). Full history from launch needs an archive RPC
 * (set RH_RPC to an Alchemy URL) and can take a while — run it in ranges.
 */
import { openDb } from "./db.js";
import { config, robinhoodChain } from "./config.js";
import { Indexer } from "./indexer.js";
import { createPublicClient, http, type PublicClient } from "viem";
import * as t from "./schema.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];
  const dbPath = arg("db") ?? "data.sqlite";
  const rpc = process.env.RH_RPC ?? config.chain.rpcUrl;
  const reorgBuffer = numericArg("reorg-buffer", 64);
  const { db } = openDb(dbPath);
  const client = createPublicClient({ chain: robinhoodChain, transport: http(rpc) }) as PublicClient;
  const idx = new Indexer(db, config, client, { reorgBuffer });
  idx.seedTokens();

  if (cmd === "discover-pools") {
    const n = await idx.discoverPools();
    console.log(`discovered/confirmed ${n} pools`);
    return;
  }

  if (cmd === "backfill") {
    const from = Number(arg("from"));
    const to = Number(arg("to"));
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("--from and --to required");
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
      throw new Error("--from/--to must define a non-negative ascending integer range");
    }
    const state = idx.getState();
    if (state && from > state.lastBlock + 1) {
      throw new Error(
        `non-contiguous backfill: stored tip=${state.lastBlock}, requested from=${from}; fill the gap first`,
      );
    }
    if (db.select().from(t.uniPools).all().length === 0) await idx.discoverPools();
    console.log(`backfilling [${from}, ${to}] on ${config.chain.name} (${config.chain.chainId})`);
    await idx.indexRange(from, to);
    if (!state || to > state.lastBlock) {
      const tip = await idx.recordHeader(to);
      const streamStart = state?.startBlock ?? from;
      const anchor = Math.max(streamStart, to - reorgBuffer);
      if (anchor !== to) await idx.recordHeader(anchor);
      idx.setState(to, tip.hash, to, streamStart);
    }
    console.log("done:", stats(db));
    return;
  }

  if (cmd === "sync" || cmd === "follow") {
    if (db.select().from(t.uniPools).all().length === 0) await idx.discoverPools();
    const start = optionalNumericArg("start");
    const run = async () => {
      const result = await idx.syncOnce(start);
      console.log(JSON.stringify(result));
    };
    if (cmd === "sync") {
      await run();
      return;
    }
    const pollMs = numericArg("poll-ms", 5000);
    if (pollMs < 250) throw new Error("--poll-ms must be at least 250");
    console.log(`following finalized head every ${pollMs}ms (reorg buffer=${reorgBuffer})`);
    while (true) {
      await run();
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  if (cmd === "stats") {
    console.log(stats(db));
    return;
  }

  console.error("usage: backfill | sync | follow | discover-pools | stats");
  process.exit(1);
}

function optionalNumericArg(name: string): number | undefined {
  const value = arg(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer`);
  return parsed;
}

function numericArg(name: string, fallback: number): number {
  return optionalNumericArg(name) ?? fallback;
}

function stats(db: ReturnType<typeof openDb>["db"]) {
  const count = (tbl: any) => db.select().from(tbl).all().length;
  return {
    agents: count(t.agents),
    tokens: count(t.tokens),
    pools: count(t.uniPools),
    tokenTransfers: count(t.tokenTransfers),
    swaps: count(t.swaps),
    priceUpdates: count(t.priceUpdates),
    multiplierUpdates: count(t.multiplierUpdates),
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
