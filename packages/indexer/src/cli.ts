#!/usr/bin/env -S npx tsx
/**
 * rh-index — a small CLI around the indexer.
 *
 *   tsx src/cli.ts backfill --db data.sqlite --from <block> --to <block>
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
  const { db } = openDb(dbPath);
  const client = createPublicClient({ chain: robinhoodChain, transport: http(rpc) }) as PublicClient;
  const idx = new Indexer(db, config, client);
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
    await idx.discoverPools();
    console.log(`backfilling [${from}, ${to}] on ${config.chain.name} (${config.chain.chainId})`);
    await idx.indexRange(from, to);
    const head = await client.getBlock({ blockNumber: BigInt(to) });
    idx.setState(to, head.hash!, to, from);
    console.log("done:", stats(db));
    return;
  }

  if (cmd === "stats") {
    console.log(stats(db));
    return;
  }

  console.error("usage: backfill | discover-pools | stats");
  process.exit(1);
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
