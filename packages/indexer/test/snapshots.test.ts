import { afterEach, describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { openDb } from "../src/db.js";
import { config, type IndexerConfig } from "../src/config.js";
import { Indexer } from "../src/indexer.js";
import * as t from "../src/schema.js";

describe("Chainlink event/cadence snapshots", () => {
  const opened: ReturnType<typeof openDb>[] = [];

  afterEach(() => {
    for (const item of opened.splice(0)) item.sqlite.close();
  });

  it("reads relevant proxies at event blocks and all proxies on the fixed cadence", async () => {
    const aapl = config.scoreableTokens.find((token) => token.symbol === "AAPL")!;
    const trimmed: IndexerConfig = {
      ...config,
      canonicalStockTokens: [
        { symbol: aapl.symbol, address: aapl.address, decimals: aapl.decimals, isin: aapl.isin },
      ],
      scoreableTokens: [aapl],
    };
    const calls: Array<{ address: string; block: number }> = [];
    const client = {
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        hash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
        parentHash: `0x${(blockNumber - 1n).toString(16).padStart(64, "0")}`,
        timestamp: 1_700_000_000n + blockNumber,
      }),
      readContract: async ({ address, blockNumber }: { address: string; blockNumber: bigint }) => {
        calls.push({ address: address.toLowerCase(), block: Number(blockNumber) });
        const answer =
          address.toLowerCase() === trimmed.quoteAssets.WETH.feedProxy.toLowerCase()
            ? 500_000_000_000n
            : address.toLowerCase() === trimmed.quoteAssets.USDG.feedProxy.toLowerCase()
              ? 100_000_000n
              : 30_000_000_000n;
        return [1n, answer, 0n, 1_700_000_000n, 1n] as const;
      },
    } as unknown as PublicClient;

    const openedDb = openDb(":memory:");
    opened.push(openedDb);
    const { db } = openedDb;
    const indexer = new Indexer(db, trimmed, client, { priceCadenceBlocks: 10 });
    db.insert(t.tokenTransfers)
      .values({
        token: aapl.address.toLowerCase(),
        fromAddr: "0xpool",
        toAddr: "0xagent",
        rawValue: "1",
        uiValue: "1",
        scoreable: true,
        blockNumber: 103,
        blockTimestamp: 1_700_000_103,
        txHash: "0xstocktx",
        logIndex: 1,
      })
      .run();
    db.insert(t.cashTransfers)
      .values({
        token: trimmed.quoteAssets.USDG.address.toLowerCase(),
        fromAddr: "0xagent",
        toAddr: "0xelse",
        value: "1",
        blockNumber: 104,
        blockTimestamp: 1_700_000_104,
        txHash: "0xcashtx",
        logIndex: 1,
      })
      .run();
    db.insert(t.swaps)
      .values({
        pool: "0xpool",
        stockToken: aapl.address.toLowerCase(),
        quoteToken: trimmed.quoteAssets.WETH.address.toLowerCase(),
        stockAmount: "-1",
        quoteAmount: "1",
        sender: "0xrouter",
        recipient: "0xagent",
        blockNumber: 103,
        blockTimestamp: 1_700_000_103,
        txHash: "0xstocktx",
        logIndex: 0,
      })
      .run();
    db.insert(t.agentWalletHistory)
      .values({
        agentId: "1",
        wallet: "0x1111111111111111111111111111111111111111",
        blockNumber: 105,
        blockTimestamp: 1_700_000_105,
        txHash: "0xbinding",
        logIndex: 0,
      })
      .run();

    await indexer.indexPriceSnapshots(100, 110);
    await indexer.indexPriceSnapshots(100, 110); // idempotent rows

    const rows = db.select().from(t.priceSnapshots).all();
    expect(rows).toHaveLength(13);
    expect(calls).toHaveLength(26);
    expect(
      rows.find(
        (row) => row.feedProxy === aapl.feedProxy.toLowerCase() && row.blockNumber === 103,
      )?.source,
    ).toBe("event");
    expect(
      rows.find(
        (row) =>
          row.feedProxy === trimmed.quoteAssets.WETH.feedProxy.toLowerCase() &&
          row.blockNumber === 103,
      )?.answer,
    ).toBe("500000000000");
    expect(rows.filter((row) => row.blockNumber === 100)).toHaveLength(3);
    expect(rows.filter((row) => row.blockNumber === 105)).toHaveLength(3);
    expect(rows.filter((row) => row.blockNumber === 110)).toHaveLength(3);
  });
});
