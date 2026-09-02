import { afterEach, describe, expect, it } from "vitest";
import { config, openDb, schema, type IndexerConfig } from "@assayhq/indexer";
import { MetricsEngine } from "../src/engine.js";

const wallet = "0x1111111111111111111111111111111111111111";
const source = "0x2222222222222222222222222222222222222222";
const pool = "0x3333333333333333333333333333333333333333";

describe("MetricsEngine", () => {
  const opened: ReturnType<typeof openDb>[] = [];
  afterEach(() => {
    for (const item of opened.splice(0)) item.sqlite.close();
  });

  it("reconstructs net performance and is invariant to future prices", () => {
    const openedDb = openDb(":memory:");
    opened.push(openedDb);
    const { db } = openedDb;
    const aapl = config.scoreableTokens.find((token) => token.symbol === "AAPL")!;
    const spy = config.scoreableTokens.find((token) => token.symbol === "SPY")!;
    const trimmed: IndexerConfig = {
      ...config,
      canonicalStockTokens: [
        { symbol: aapl.symbol, address: aapl.address, decimals: 18, isin: aapl.isin },
        { symbol: spy.symbol, address: spy.address, decimals: 18, isin: spy.isin },
      ],
      scoreableTokens: [aapl, spy],
    };

    db.insert(schema.indexerState)
      .values({
        id: "main",
        lastBlock: 300,
        lastBlockHash: "0x300",
        finalizedBlock: 300,
        startBlock: 0,
        updatedAt: 0,
      })
      .run();
    db.insert(schema.agents)
      .values({
        agentId: "1",
        owner: wallet,
        agentWallet: wallet,
        agentURI: "ipfs://agent-1",
        registeredBlock: 100,
        registeredAt: 1_000,
        registeredTx: "0xregister",
      })
      .run();
    // A registered agent with no wallet/trades must remain in the scoreboard.
    db.insert(schema.agents)
      .values({
        agentId: "2",
        owner: source,
        agentWallet: null,
        agentURI: "ipfs://agent-2",
        registeredBlock: 120,
        registeredAt: 1_200,
        registeredTx: "0xregister2",
      })
      .run();
    db.insert(schema.agentWalletHistory)
      .values({
        agentId: "1",
        wallet,
        blockNumber: 100,
        blockTimestamp: 1_000,
        txHash: "0xregister",
        logIndex: 0,
      })
      .run();

    const feeds = [
      { address: aapl.feedProxy, at100: 30_000_000_000n, at200: 33_000_000_000n },
      { address: spy.feedProxy, at100: 50_000_000_000n, at200: 51_000_000_000n },
      { address: trimmed.quoteAssets.USDG.feedProxy, at100: 100_000_000n, at200: 100_000_000n },
      { address: trimmed.quoteAssets.WETH.feedProxy, at100: 500_000_000_000n, at200: 500_000_000_000n },
    ];
    for (const feed of feeds) {
      for (const [block, answer, sourceKind] of [
        [100, feed.at100, "both"],
        [200, feed.at200, "cadence"],
        [300, feed.address === aapl.feedProxy ? 100_000_000_000n : feed.at200, "cadence"],
      ] as const) {
        db.insert(schema.priceSnapshots)
          .values({
            feedProxy: feed.address.toLowerCase(),
            answer: answer.toString(),
            roundId: String(block),
            updatedAt: block * 10,
            blockNumber: block,
            blockTimestamp: block * 10,
            source: sourceKind,
          })
          .run();
      }
    }
    // Exact execution-block snapshots (SPY can correctly use its prior value).
    for (const [address, answer] of [
      [aapl.feedProxy, 30_000_000_000n],
      [trimmed.quoteAssets.USDG.feedProxy, 100_000_000n],
      [trimmed.quoteAssets.WETH.feedProxy, 500_000_000_000n],
    ] as const) {
      db.insert(schema.priceSnapshots)
        .values({
          feedProxy: address.toLowerCase(),
          answer: answer.toString(),
          roundId: "150",
          updatedAt: 1_500,
          blockNumber: 150,
          blockTimestamp: 1_500,
          source: "event",
        })
        .run();
    }

    db.insert(schema.cashTransfers)
      .values({
        token: trimmed.quoteAssets.USDG.address.toLowerCase(),
        fromAddr: source,
        toAddr: wallet,
        value: (1_000n * 10n ** 6n).toString(),
        blockNumber: 100,
        blockTimestamp: 1_000,
        txHash: "0xdeposit",
        logIndex: 2,
      })
      .run();
    db.insert(schema.cashTransfers)
      .values({
        token: trimmed.quoteAssets.USDG.address.toLowerCase(),
        fromAddr: wallet,
        toAddr: pool,
        value: (612n * 10n ** 6n).toString(),
        blockNumber: 150,
        blockTimestamp: 1_500,
        txHash: "0xbuy",
        logIndex: 2,
      })
      .run();
    const swapResult = db
      .insert(schema.swaps)
      .values({
        pool,
        stockToken: aapl.address.toLowerCase(),
        quoteToken: trimmed.quoteAssets.USDG.address.toLowerCase(),
        stockAmount: (-2n * 10n ** 18n).toString(),
        quoteAmount: (612n * 10n ** 6n).toString(),
        sender: wallet,
        recipient: wallet,
        blockNumber: 150,
        blockTimestamp: 1_500,
        txHash: "0xbuy",
        logIndex: 1,
      })
      .run();
    db.insert(schema.tokenTransfers)
      .values({
        token: aapl.address.toLowerCase(),
        fromAddr: pool,
        toAddr: wallet,
        rawValue: (2n * 10n ** 18n).toString(),
        uiValue: (2n * 10n ** 18n).toString(),
        scoreable: true,
        blockNumber: 150,
        blockTimestamp: 1_500,
        txHash: "0xbuy",
        logIndex: 3,
        attributionStatus: "matched",
        attributedSwapId: Number(swapResult.lastInsertRowid),
        attributionMethod: "pool-counterparty",
      })
      .run();
    db.insert(schema.txGas)
      .values({
        txHash: "0xdeposit",
        blockNumber: 100,
        gasUsed: "21000",
        effectiveGasPrice: "1000000000",
        txFrom: source,
      })
      .run();
    db.insert(schema.txGas)
      .values({
        txHash: "0xbuy",
        blockNumber: 150,
        gasUsed: "21000",
        effectiveGasPrice: "1000000000",
        txFrom: wallet,
      })
      .run();

    const first = new MetricsEngine(db, trimmed, { cadenceBlocks: 100, evaluationBlock: 200 })
      .scoreAgent("1");
    expect(first.status).toBe("scored");
    expect(first.scope.coverageRatio).toBe(1);
    expect(first.metrics.portfolioNavUsd8).toBe("104800000000");
    expect(first.metrics.gasCostUsd8).toBe("10500000"); // $0.105
    expect(first.metrics.slippageCostUsd8).toBe("1200000000"); // $12 vs Chainlink mid
    expect(first.metrics.netReturn).toBeCloseTo(0.047895, 10);
    expect(first.metrics.grossReturn).toBeCloseTo(0.06, 12);
    expect(first.metrics.benchmarkReturn).toBeCloseTo(0.02, 12);
    expect(first.metrics.timeInMarket).toBeCloseTo(0.5, 12);
    const all = new MetricsEngine(db, trimmed, { cadenceBlocks: 100, evaluationBlock: 200 })
      .scoreAll();
    expect(all.agents.map((agent) => agent.agentId)).toContain("2");
    expect(all.agents.find((agent) => agent.agentId === "2")?.reasons).toContain(
      "no-verified-wallet-binding",
    );

    // This is the hard lookahead regression: mutating a future price must not
    // change a score pinned to block 200.
    openedDb.sqlite
      .prepare("UPDATE price_snapshots SET answer = ? WHERE block_number = 300")
      .run("999999999999999");
    const second = new MetricsEngine(db, trimmed, { cadenceBlocks: 100, evaluationBlock: 200 })
      .scoreAgent("1");
    expect(second.metrics.netReturn).toBe(first.metrics.netReturn);
    expect(second.metrics.portfolioNavUsd8).toBe(first.metrics.portfolioNavUsd8);
  });
});
