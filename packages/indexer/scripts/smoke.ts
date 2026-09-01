/**
 * Live smoke test against Robinhood Chain mainnet.
 *
 * Proves the real ingestion path end-to-end on a bounded recent window, kept
 * deliberately small because the PUBLIC RPC rate-limits (HTTP 429) — we scope to
 * ONE token (AAPL) and lean on viem's retry/backoff. It discovers the Uniswap
 * pool by call, then indexes swaps + Chainlink prices + multiplier updates +
 * agent registrations over the last N blocks into an in-memory SQLite.
 *
 * Network-dependent, so NOT part of `pnpm test`.
 *   RH_RPC=<url> WINDOW=1500 pnpm --filter @rhchain/indexer smoke
 */
import { openDb } from "../src/db.js";
import { config, robinhoodChain, type IndexerConfig } from "../src/config.js";
import { Indexer } from "../src/indexer.js";
import { createPublicClient, http, type PublicClient } from "viem";
import * as t from "../src/schema.js";

async function main() {
  const rpc = process.env.RH_RPC ?? config.chain.rpcUrl;
  const window = Number(process.env.WINDOW ?? 1500);
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(rpc, { retryCount: 8, retryDelay: 600, timeout: 30_000 }),
  }) as PublicClient;

  const head = Number(await client.getBlockNumber());
  const from = Math.max(0, head - window);
  console.log(`chain ${config.chain.chainId} head=${head} window=[${from}, ${head}]`);

  // Scope to a single, liquid token to keep RPC pressure low.
  const aapl = config.scoreableTokens.find((x) => x.symbol === "AAPL")!;
  const trimmed: IndexerConfig = { ...config, scoreableTokens: [aapl] };

  const { db } = openDb(":memory:");
  const idx = new Indexer(db, trimmed, client, { logChunk: 500 });
  idx.seedTokens();

  const pools = await idx.discoverPools();
  console.log(`AAPL pools discovered (getPool): ${pools}`);
  const nMult = await idx.indexMultiplierUpdates(from, head);
  const nPrices = await idx.indexPrices(from, head);
  const nSwaps = await idx.indexSwaps(from, head);
  const nAgents = await idx.indexAgents(from, head);
  const nTransfers = await idx.indexAgentTransfers(from, head);
  idx.attribute(from, head);

  console.log("ingested in window:", { pools, nSwaps, nPrices, nMult, nAgents, nTransfers });

  const s = db.select().from(t.swaps).all()[0];
  if (s) console.log("sample swap:", { pool: s.pool, stock: s.stockAmount, quote: s.quoteAmount, block: s.blockNumber });
  const p = db.select().from(t.priceUpdates).all()[0];
  if (p) console.log("sample price:", { feed: p.feedProxy, answer: p.answer, updatedAt: p.updatedAt });
  const pool = db.select().from(t.uniPools).all()[0];
  if (pool) console.log("sample pool:", { address: pool.address, fee: pool.fee, stock: pool.stockToken, quote: pool.quoteToken });
  console.log("OK");
}

main().catch((e) => {
  console.error("smoke failed:", e);
  process.exit(1);
});
