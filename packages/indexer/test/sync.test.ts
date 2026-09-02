import { afterEach, describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { openDb, type Db } from "../src/db.js";
import { config } from "../src/config.js";
import { Indexer } from "../src/indexer.js";
import * as t from "../src/schema.js";

const hash = (n: number, branch = 0): `0x${string}` =>
  `0x${(BigInt(branch) * 1_000_000n + BigInt(n)).toString(16).padStart(64, "0")}`;

class FakeChain {
  head = 110;
  branchFrom = Number.MAX_SAFE_INTEGER;

  client(): PublicClient {
    return {
      getBlockNumber: async () => BigInt(this.head),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
        const n = Number(blockNumber);
        const branch = n >= this.branchFrom ? 1 : 0;
        const parentBranch = n - 1 >= this.branchFrom ? 1 : 0;
        return {
          hash: hash(n, branch),
          parentHash: hash(n - 1, parentBranch),
          timestamp: BigInt(1_700_000_000 + n),
        };
      },
    } as unknown as PublicClient;
  }
}

class RecordingIndexer extends Indexer {
  readonly ranges: Array<[number, number]> = [];

  constructor(db: Db, chain: FakeChain, reorgBuffer: number) {
    super(db, config, chain.client(), { reorgBuffer });
  }

  override async indexRange(fromBlock: number, toBlock: number): Promise<void> {
    this.ranges.push([fromBlock, toBlock]);
  }
}

describe("syncOnce", () => {
  const opened: ReturnType<typeof openDb>[] = [];

  afterEach(() => {
    for (const item of opened.splice(0)) item.sqlite.close();
  });

  function setup(buffer = 5) {
    const db = openDb(":memory:");
    opened.push(db);
    const chain = new FakeChain();
    const indexer = new RecordingIndexer(db.db, chain, buffer);
    return { ...db, chain, indexer };
  }

  it("requires an explicit start on the first run and resumes from its cursor", async () => {
    const { indexer, chain } = setup();
    await expect(indexer.syncOnce()).rejects.toThrow("first sync requires");

    const first = await indexer.syncOnce(100);
    expect(first).toMatchObject({ finalizedBlock: 105, indexedFrom: 100, indexedTo: 105 });
    expect(indexer.ranges).toEqual([[100, 105]]);

    chain.head = 115;
    const second = await indexer.syncOnce();
    expect(second).toMatchObject({ finalizedBlock: 110, indexedFrom: 106, indexedTo: 110 });
    expect(indexer.getState()?.lastBlock).toBe(110);
  });

  it("rolls back to a canonical checkpoint before replaying a shallow reorg", async () => {
    const { indexer, chain, db } = setup();
    await indexer.syncOnce(100); // indexed through 105; checkpoints at 100 + 105
    db.insert(t.priceUpdates)
      .values({
        feedProxy: "0xfeed",
        aggregator: "0xagg",
        answer: "1",
        roundId: "1",
        updatedAt: 1,
        blockNumber: 104,
        txHash: "0xtx",
        logIndex: 0,
      })
      .run();

    chain.branchFrom = 101;
    chain.head = 115;
    const result = await indexer.syncOnce();
    expect(result).toMatchObject({ rolledBackTo: 100, indexedFrom: 101, indexedTo: 110 });
    expect(db.select().from(t.priceUpdates).all()).toEqual([]);
    expect(indexer.getState()?.lastBlockHash).toBe(hash(110, 1));
  });

  it("fails closed when the reorg is deeper than the stored buffer", async () => {
    const { indexer, chain } = setup();
    await indexer.syncOnce(100); // 105
    chain.head = 115;
    await indexer.syncOnce(); // 110, anchor 105

    chain.branchFrom = 104; // both stored headers 105 and 110 diverge
    chain.head = 120;
    await expect(indexer.syncOnce()).rejects.toThrow("reorg exceeds 5-block buffer");
    expect(indexer.getState()?.lastBlock).toBe(110);
  });
});
