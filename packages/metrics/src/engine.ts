import { rawBalanceValueUsd } from "@rhchain/erc8056";
import {
  ZERO_ADDRESS,
  adverseSlippageBps,
  classifyAgentCoverage,
  execPriceUsdPerToken,
  schema,
  type Db,
  type IndexerConfig,
} from "@rhchain/indexer";
import { asOfBlock, atOrBefore, comparePosition, walletAsOf } from "./point-in-time.js";
import {
  annualizedRatio,
  capacityDecaySlope,
  maxDrawdown,
} from "./statistics.js";
import type {
  AgentScore,
  ChainPosition,
  NavPoint,
  ScoreboardSnapshot,
  TimedCost,
  TimedUsdFlow,
} from "./types.js";

const USD_DECIMALS = 8;
const END_OF_BLOCK = Number.MAX_SAFE_INTEGER;
const lc = (value: string) => value.toLowerCase();
const abs = (value: bigint) => (value < 0n ? -value : value);

type AgentRow = typeof schema.agents.$inferSelect;
type BindingRow = typeof schema.agentWalletHistory.$inferSelect;
type TokenTransferRow = typeof schema.tokenTransfers.$inferSelect;
type CashTransferRow = typeof schema.cashTransfers.$inferSelect;
type SwapRow = typeof schema.swaps.$inferSelect;
type PriceSnapshotRow = typeof schema.priceSnapshots.$inferSelect;

interface AssetMeta {
  address: string;
  symbol: string;
  decimals: number;
  feedProxy: string;
  feedDecimals: number;
  kind: "stock" | "cash";
}

interface BindingPoint extends ChainPosition {
  wallet: string | null;
  timestamp: number;
}

interface BindingSegment {
  wallet: string;
  start: ChainPosition;
  end: ChainPosition;
  startTimestamp: number;
  endTimestamp: number;
}

interface LedgerDelta extends ChainPosition {
  delta: bigint;
  running?: bigint;
}

interface Valuation {
  navUsd8: bigint;
  stockUsd8: bigint;
  missingFeeds: string[];
  negativeAssets: string[];
}

interface TradeFact extends ChainPosition {
  timestamp: number;
  txHash: string;
  quoteToken: string;
  quoteAmountRaw: bigint;
  scoreable: boolean;
  notionalUsd8: bigint | null;
  slippageUsd8: bigint | null;
  adverseBps: number | null;
  side: "buy" | "sell";
}

export interface MetricsOptions {
  benchmarkSymbol?: string;
  cadenceBlocks?: number;
  evaluationBlock?: number;
}

class PriceBook {
  private readonly byFeed = new Map<string, PriceSnapshotRow[]>();
  private readonly timestampByBlock = new Map<number, number>();

  constructor(rows: readonly PriceSnapshotRow[]) {
    for (const row of rows) {
      const key = lc(row.feedProxy);
      const list = this.byFeed.get(key) ?? [];
      list.push(row);
      this.byFeed.set(key, list);
      this.timestampByBlock.set(row.blockNumber, row.blockTimestamp);
    }
    for (const list of this.byFeed.values()) {
      list.sort((a, b) => a.blockNumber - b.blockNumber);
    }
  }

  asOf(feedProxy: string, blockNumber: number): PriceSnapshotRow | null {
    return asOfBlock(this.byFeed.get(lc(feedProxy)) ?? [], blockNumber);
  }

  timestamp(blockNumber: number): number | null {
    return this.timestampByBlock.get(blockNumber) ?? null;
  }

  completeCadenceBlocks(requiredFeeds: readonly string[], cadence: number): number[] {
    const required = new Set(requiredFeeds.map(lc));
    const byBlock = new Map<number, Set<string>>();
    for (const [feed, rows] of this.byFeed) {
      if (!required.has(feed)) continue;
      for (const row of rows) {
        if (row.blockNumber % cadence !== 0) continue;
        const set = byBlock.get(row.blockNumber) ?? new Set<string>();
        set.add(feed);
        byBlock.set(row.blockNumber, set);
      }
    }
    return [...byBlock]
      .filter(([, feeds]) => feeds.size === required.size)
      .map(([block]) => block)
      .sort((a, b) => a - b);
  }
}

class WalletLedger {
  private readonly deltas = new Map<string, LedgerDelta[]>();

  constructor(
    tokenRows: readonly TokenTransferRow[],
    cashRows: readonly CashTransferRow[],
    knownWallets: ReadonlySet<string>,
  ) {
    const add = (wallet: string, asset: string, row: ChainPosition, delta: bigint) => {
      const normalizedWallet = lc(wallet);
      if (!knownWallets.has(normalizedWallet)) return;
      const key = `${normalizedWallet}:${lc(asset)}`;
      const list = this.deltas.get(key) ?? [];
      list.push({ ...row, delta });
      this.deltas.set(key, list);
    };
    for (const row of tokenRows) {
      const position = { blockNumber: row.blockNumber, logIndex: row.logIndex };
      const amount = BigInt(row.rawValue);
      add(row.fromAddr, row.token, position, -amount);
      add(row.toAddr, row.token, position, amount);
    }
    for (const row of cashRows) {
      const position = { blockNumber: row.blockNumber, logIndex: row.logIndex };
      const amount = BigInt(row.value);
      add(row.fromAddr, row.token, position, -amount);
      add(row.toAddr, row.token, position, amount);
    }
    for (const list of this.deltas.values()) {
      list.sort(comparePosition);
      let running = 0n;
      for (const item of list) {
        running += item.delta;
        item.running = running;
      }
    }
  }

  balance(wallet: string, asset: string, position: ChainPosition): bigint {
    const rows = this.deltas.get(`${lc(wallet)}:${lc(asset)}`) ?? [];
    let lo = 0;
    let hi = rows.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (atOrBefore(rows[mid]!, position)) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found < 0 ? 0n : rows[found]!.running!;
  }
}

export class MetricsEngine {
  private readonly agents: AgentRow[];
  private readonly bindings: BindingRow[];
  private readonly tokenRows: TokenTransferRow[];
  private readonly cashRows: CashTransferRow[];
  private readonly swaps: SwapRow[];
  private readonly prices: PriceBook;
  private readonly ledger: WalletLedger;
  private readonly assets = new Map<string, AssetMeta>();
  private readonly stockAssets: AssetMeta[];
  private readonly bindingsByAgent = new Map<string, BindingPoint[]>();
  private readonly ownersByAgent = new Map<string, Array<ChainPosition & { owner: string }>>();
  private readonly swapsById = new Map<number, SwapRow>();
  private readonly gasByTx = new Map<string, typeof schema.txGas.$inferSelect>();
  private readonly cadenceBlocks: number[];
  private readonly benchmark: AssetMeta;
  private readonly evaluationBlock: number;
  private readonly evaluationTimestamp: number;
  private readonly cadence: number;

  constructor(
    private readonly db: Db,
    private readonly cfg: IndexerConfig,
    options: MetricsOptions = {},
  ) {
    this.cadence = options.cadenceBlocks ?? 36_000;
    if (!Number.isSafeInteger(this.cadence) || this.cadence <= 0) {
      throw new RangeError("cadenceBlocks must be a positive integer");
    }
    this.agents = db.select().from(schema.agents).all();
    this.bindings = db.select().from(schema.agentWalletHistory).all();
    this.tokenRows = db.select().from(schema.tokenTransfers).all();
    this.cashRows = db.select().from(schema.cashTransfers).all();
    this.swaps = db.select().from(schema.swaps).all();
    this.prices = new PriceBook(db.select().from(schema.priceSnapshots).all());

    const scoreable = new Map(this.cfg.scoreableTokens.map((token) => [lc(token.address), token]));
    for (const token of this.cfg.canonicalStockTokens) {
      const covered = scoreable.get(lc(token.address));
      if (!covered) continue;
      this.assets.set(lc(token.address), {
        address: lc(token.address),
        symbol: token.symbol,
        decimals: token.decimals,
        feedProxy: lc(covered.feedProxy),
        feedDecimals: covered.feedDecimals,
        kind: "stock",
      });
    }
    for (const [symbol, quote] of Object.entries(this.cfg.quoteAssets)) {
      this.assets.set(lc(quote.address), {
        address: lc(quote.address),
        symbol,
        decimals: quote.decimals,
        feedProxy: lc(quote.feedProxy),
        feedDecimals: quote.feedDecimals,
        kind: "cash",
      });
    }
    this.stockAssets = [...this.assets.values()].filter((asset) => asset.kind === "stock");
    const benchmarkSymbol = options.benchmarkSymbol ?? "SPY";
    const benchmark = this.stockAssets.find((asset) => asset.symbol === benchmarkSymbol);
    if (!benchmark) throw new Error(`benchmark ${benchmarkSymbol} is not feed-covered`);
    this.benchmark = benchmark;

    for (const row of this.bindings) {
      const list = this.bindingsByAgent.get(row.agentId) ?? [];
      list.push({
        blockNumber: row.blockNumber,
        logIndex: row.logIndex,
        timestamp: row.blockTimestamp,
        wallet: lc(row.wallet) === ZERO_ADDRESS ? null : lc(row.wallet),
      });
      this.bindingsByAgent.set(row.agentId, list);
    }
    for (const list of this.bindingsByAgent.values()) list.sort(comparePosition);
    for (const row of db.select().from(schema.agentOwnerHistory).all()) {
      const list = this.ownersByAgent.get(row.agentId) ?? [];
      list.push({ blockNumber: row.blockNumber, logIndex: row.logIndex, owner: lc(row.owner) });
      this.ownersByAgent.set(row.agentId, list);
    }
    for (const list of this.ownersByAgent.values()) list.sort(comparePosition);
    const knownWallets = new Set(
      [...this.bindingsByAgent.values()].flatMap((list) =>
        list.flatMap((point) => (point.wallet ? [point.wallet] : [])),
      ),
    );
    this.ledger = new WalletLedger(this.tokenRows, this.cashRows, knownWallets);
    for (const row of this.swaps) this.swapsById.set(row.id, row);
    for (const row of db.select().from(schema.txGas).all()) this.gasByTx.set(row.txHash, row);

    const requiredFeeds = [...this.assets.values()].map((asset) => asset.feedProxy);
    this.cadenceBlocks = this.prices.completeCadenceBlocks(requiredFeeds, this.cadence);
    const indexedFinalized = Math.max(
      -1,
      ...db.select().from(schema.indexerState).all().map((state) => state.finalizedBlock),
    );
    const requested = options.evaluationBlock;
    if (requested !== undefined && requested > indexedFinalized) {
      throw new Error(`evaluation block ${requested} exceeds indexed finalized block ${indexedFinalized}`);
    }
    const resolved =
      requested ?? this.cadenceBlocks.filter((block) => block <= indexedFinalized).at(-1);
    if (resolved === undefined) throw new Error("no complete point-in-time price cadence is indexed");
    const timestamp = this.prices.timestamp(resolved);
    if (timestamp === null) throw new Error(`no block timestamp for evaluation block ${resolved}`);
    this.evaluationBlock = resolved;
    this.evaluationTimestamp = timestamp;
  }

  scoreAll(): ScoreboardSnapshot {
    return {
      schemaVersion: 1,
      chainId: this.cfg.chain.chainId,
      evaluationBlock: this.evaluationBlock,
      generatedAt: new Date().toISOString(),
      agents: this.agents
        .map((agent) => this.scoreAgent(agent.agentId))
        .sort((a, b) => {
          const aReturn = a.metrics.netReturn ?? Number.NEGATIVE_INFINITY;
          const bReturn = b.metrics.netReturn ?? Number.NEGATIVE_INFINITY;
          return bReturn - aReturn || a.agentId.localeCompare(b.agentId);
        }),
    };
  }

  scoreAgent(agentId: string): AgentScore {
    const agent = this.agents.find((row) => row.agentId === agentId);
    if (!agent) throw new Error(`unknown agent ${agentId}`);
    const bindings = this.bindingsByAgent.get(agentId) ?? [];
    const segments = buildBindingSegments(
      bindings,
      agent.registeredBlock,
      this.evaluationBlock,
      this.evaluationTimestamp,
    );
    const reasons = new Set<string>();
    const overlappingWalletBinding = this.hasOverlappingBinding(agentId, segments);
    if (overlappingWalletBinding) reasons.add("overlapping-wallet-binding");
    if (segments.length === 0) reasons.add("no-verified-wallet-binding");

    const tradeFacts: TradeFact[] = [];
    const flowCoverage: Array<{ scoreable: boolean; usdVolume: bigint | null }> = [];
    const activeTx = new Map<string, ChainPosition>();
    let unattributedTransfers = 0;
    let ambiguousTransfers = 0;

    for (const row of this.tokenRows) {
      const position = { blockNumber: row.blockNumber, logIndex: row.logIndex };
      if (position.blockNumber < agent.registeredBlock || position.blockNumber > this.evaluationBlock) continue;
      const wallet = walletAsOf(bindings, position);
      if (!wallet || !touchesOnly(wallet, row.fromAddr, row.toAddr)) continue;
      rememberTxPosition(activeTx, row.txHash, position);
      if (row.attributionStatus !== "matched" || row.attributedSwapId === null) {
        if (row.attributionStatus === "ambiguous") ambiguousTransfers++;
        else unattributedTransfers++;
        continue;
      }
      const swap = this.swapsById.get(row.attributedSwapId);
      if (!swap) {
        reasons.add("missing-attributed-swap");
        flowCoverage.push({ scoreable: row.scoreable, usdVolume: null });
        continue;
      }
      if (BigInt(row.rawValue) !== abs(BigInt(swap.stockAmount))) {
        reasons.add("stock-leg-amount-mismatch");
      }
      const quote = this.assets.get(lc(swap.quoteToken));
      const quoteSnapshot = quote ? this.prices.asOf(quote.feedProxy, row.blockNumber) : null;
      const notionalUsd8 =
        quote && quoteSnapshot
          ? valueUsd8(abs(BigInt(swap.quoteAmount)), quote, BigInt(quoteSnapshot.answer))
          : null;
      flowCoverage.push({ scoreable: row.scoreable, usdVolume: notionalUsd8 });
      const side: "buy" | "sell" = lc(row.toAddr) === wallet ? "buy" : "sell";
      if (
        (side === "buy" && BigInt(swap.stockAmount) >= 0n) ||
        (side === "sell" && BigInt(swap.stockAmount) <= 0n)
      ) {
        reasons.add("swap-direction-mismatch");
      }
      let slippageUsd8: bigint | null = null;
      let adverseBps: number | null = null;
      if (row.scoreable) {
        const stock = this.assets.get(lc(row.token));
        const stockSnapshot = stock ? this.prices.asOf(stock.feedProxy, row.blockNumber) : null;
        if (stock && stockSnapshot && quote && quoteSnapshot) {
          const mid = normalizePrice(
            BigInt(stockSnapshot.answer),
            stock.feedDecimals,
            USD_DECIMALS,
          );
          const exec = execPriceUsdPerToken({
            stockAmountRaw: BigInt(swap.stockAmount),
            quoteAmountRaw: BigInt(swap.quoteAmount),
            stockDecimals: stock.decimals,
            quoteDecimals: quote.decimals,
            quoteUsdPrice: BigInt(quoteSnapshot.answer),
            quotePriceDecimals: quote.feedDecimals,
            outDecimals: USD_DECIMALS,
          });
          adverseBps = adverseSlippageBps(exec, mid, side);
          const adverseDiff = side === "buy" ? exec - mid : mid - exec;
          slippageUsd8 = signedTokenValueUsd8(
            abs(BigInt(swap.stockAmount)),
            adverseDiff,
            stock.decimals,
          );
        } else {
          reasons.add("missing-trade-price");
        }
      }
      tradeFacts.push({
        ...position,
        timestamp: row.blockTimestamp,
        txHash: row.txHash,
        quoteToken: lc(swap.quoteToken),
        quoteAmountRaw: abs(BigInt(swap.quoteAmount)),
        scoreable: row.scoreable,
        notionalUsd8,
        slippageUsd8,
        adverseBps,
        side,
      });
    }

    if (unattributedTransfers > 0) reasons.add("unattributed-stock-flow");
    if (ambiguousTransfers > 0) reasons.add("ambiguous-stock-flow");
    const coverage = classifyAgentCoverage(flowCoverage);
    if (!coverage.scoreable) reasons.add(`coverage:${coverage.reason}`);

    const externalFlows: TimedUsdFlow[] = [];
    for (const row of this.cashRows) {
      const position = { blockNumber: row.blockNumber, logIndex: row.logIndex };
      if (position.blockNumber < agent.registeredBlock || position.blockNumber > this.evaluationBlock) continue;
      const wallet = walletAsOf(bindings, position);
      if (!wallet || !touchesOnly(wallet, row.fromAddr, row.toAddr)) continue;
      rememberTxPosition(activeTx, row.txHash, position);
      const sameQuoteTrades = tradeFacts.filter(
        (trade) => trade.txHash === row.txHash && trade.quoteToken === lc(row.token),
      );
      const exactCashLegs = sameQuoteTrades.filter(
        (trade) => trade.quoteAmountRaw === BigInt(row.value),
      );
      if (exactCashLegs.length === 1) continue;
      if (sameQuoteTrades.length > 0) {
        reasons.add(
          exactCashLegs.length > 1 ? "ambiguous-cash-leg" : "cash-leg-amount-mismatch",
        );
        // It is still evidently part of a same-token trade transaction. Do not
        // disguise the mismatch as an external contribution/withdrawal.
        continue;
      }
      const asset = this.assets.get(lc(row.token));
      const snapshot = asset ? this.prices.asOf(asset.feedProxy, row.blockNumber) : null;
      if (!asset || !snapshot) {
        reasons.add("missing-external-flow-price");
        continue;
      }
      const magnitude = valueUsd8(BigInt(row.value), asset, BigInt(snapshot.answer));
      externalFlows.push({
        ...position,
        timestamp: row.blockTimestamp,
        usd8: lc(row.toAddr) === wallet ? magnitude : -magnitude,
        kind: "external-cash",
      });
    }
    // A feed-less trade is outside the scored subportfolio. Neutralize its cash
    // leg as a withdrawal (buy) or contribution (sell), while retaining it in
    // the published coverage denominator.
    for (const trade of tradeFacts) {
      if (trade.scoreable || trade.notionalUsd8 === null) continue;
      externalFlows.push({
        blockNumber: trade.blockNumber,
        logIndex: trade.logIndex,
        timestamp: trade.timestamp,
        usd8: trade.side === "buy" ? -trade.notionalUsd8 : trade.notionalUsd8,
        kind: "excluded-asset",
      });
    }
    externalFlows.sort(comparePosition);

    const gasCosts: TimedCost[] = [];
    let unassignedGasUsd8 = 0n;
    const eth = this.assets.get(lc(this.cfg.quoteAssets.WETH.address))!;
    for (const [txHash, position] of activeTx) {
      const gas = this.gasByTx.get(txHash);
      if (!gas) {
        reasons.add("missing-gas-receipt");
        continue;
      }
      const wallet = walletAsOf(bindings, position);
      const snapshot = this.prices.asOf(eth.feedProxy, position.blockNumber);
      if (!wallet || !snapshot) {
        reasons.add("missing-gas-price");
        continue;
      }
      const gasUsd8 =
        (BigInt(gas.gasUsed) * BigInt(gas.effectiveGasPrice) * BigInt(snapshot.answer)) /
        10n ** BigInt(18 + eth.feedDecimals - USD_DECIMALS);
      const timestamp = eventTimestamp(
        txHash,
        this.tokenRows,
        this.cashRows,
        this.prices.timestamp(position.blockNumber) ?? this.evaluationTimestamp,
      );
      if (lc(gas.txFrom) === wallet) {
        gasCosts.push({ ...position, timestamp, usd8: gasUsd8, txHash });
      } else {
        unassignedGasUsd8 += gasUsd8;
      }
    }
    gasCosts.sort(comparePosition);
    const slippageCosts: TimedCost[] = tradeFacts.flatMap((trade) =>
      trade.scoreable && trade.slippageUsd8 !== null
        ? [
            {
              blockNumber: trade.blockNumber,
              logIndex: trade.logIndex,
              timestamp: trade.timestamp,
              usd8: trade.slippageUsd8,
              txHash: trade.txHash,
            },
          ]
        : [],
    );

    const series: NavPoint[] = [];
    const periodReturns: number[] = [];
    const activeReturns: number[] = [];
    const periodDurations: number[] = [];
    let netWealth = 1;
    let grossWealth = 1;
    let benchmarkWealth = 1;
    let totalSeconds = 0;
    let capitalSeconds = 0;

    for (const segment of segments) {
      const points = this.segmentPoints(segment);
      if (points.length === 0) continue;
      let previous = points[0]!;
      let previousValuation = this.valuePortfolio(segment.wallet, previous.position);
      recordValuationProblems(previousValuation, reasons);
      series.push(
        makeNavPoint(
          previous,
          segment.wallet,
          previousValuation,
          true,
          netWealth,
          grossWealth,
          benchmarkWealth,
        ),
      );
      for (const point of points.slice(1)) {
        const valuation = this.valuePortfolio(segment.wallet, point.position);
        recordValuationProblems(valuation, reasons);
        // Block timestamps are integer seconds while this chain has sub-second
        // blocks. Preserve event ordering and use a one-second minimum instead
        // of dropping same-second flows/costs from the return path.
        const duration = Math.max(1, point.timestamp - previous.timestamp);
        const flows = between(externalFlows, previous.position, point.position);
        const gases = between(gasCosts, previous.position, point.position);
        const slips = between(slippageCosts, previous.position, point.position);
        const flowUsd8 = sumBigInt(flows.map((flow) => flow.usd8));
        const gasUsd8 = sumBigInt(gases.map((cost) => cost.usd8));
        const slippageUsd8 = sumBigInt(slips.map((cost) => cost.usd8));
        const weightedFlow = flows.reduce((sum, flow) => {
          const weight = Math.max(0, Math.min(1, (point.timestamp - flow.timestamp) / duration));
          return sum + usdNumber(flow.usd8) * weight;
        }, 0);
        const denominator = usdNumber(previousValuation.navUsd8) + weightedFlow;
        let netPeriodReturn: number | null = null;
        let grossPeriodReturn: number | null = null;
        let benchmarkPeriodReturn: number | null = null;
        if (denominator > 0) {
          const netPnlUsd8 =
            valuation.navUsd8 - previousValuation.navUsd8 - flowUsd8 - gasUsd8;
          netPeriodReturn = usdNumber(netPnlUsd8) / denominator;
          grossPeriodReturn = usdNumber(netPnlUsd8 + gasUsd8 + slippageUsd8) / denominator;
          const benchmarkStart = this.priceAnswer(this.benchmark, previous.position.blockNumber);
          const benchmarkEnd = this.priceAnswer(this.benchmark, point.position.blockNumber);
          if (benchmarkStart !== null && benchmarkEnd !== null && benchmarkStart > 0n) {
            benchmarkPeriodReturn = Number(benchmarkEnd) / Number(benchmarkStart) - 1;
          }
          netWealth *= 1 + netPeriodReturn;
          grossWealth *= 1 + grossPeriodReturn;
          if (benchmarkPeriodReturn !== null) benchmarkWealth *= 1 + benchmarkPeriodReturn;
          periodReturns.push(netPeriodReturn);
          if (benchmarkPeriodReturn !== null) activeReturns.push(netPeriodReturn - benchmarkPeriodReturn);
          periodDurations.push(duration);
        }
        totalSeconds += duration;
        capitalSeconds += Math.max(0, denominator) * duration;
        series.push({
          ...makeNavPoint(
            point,
            segment.wallet,
            valuation,
            false,
            netWealth,
            grossWealth,
            benchmarkWealth,
          ),
          externalFlowUsd8: flowUsd8.toString(),
          gasCostUsd8: gasUsd8.toString(),
          slippageCostUsd8: slippageUsd8.toString(),
          netPeriodReturn,
          grossPeriodReturn,
          benchmarkPeriodReturn,
        });
        previous = point;
        previousValuation = valuation;
      }
    }

    if (periodReturns.length === 0) reasons.add("insufficient-return-history");
    const elapsedSeconds = sumNumber(periodDurations);
    const totalTradeUsd8 = sumBigInt(
      tradeFacts.flatMap((trade) =>
        trade.scoreable && trade.notionalUsd8 !== null ? [trade.notionalUsd8] : [],
      ),
    );
    const totalGasUsd8 = sumBigInt(gasCosts.map((cost) => cost.usd8));
    const totalSlippageUsd8 = sumBigInt(slippageCosts.map((cost) => cost.usd8));
    const averageCapital = totalSeconds > 0 ? capitalSeconds / totalSeconds : 0;
    const marketTime = this.timeInMarket(segments);
    const benchmarkReturn = series.length > 0 ? benchmarkWealth - 1 : null;
    const netReturn = periodReturns.length > 0 ? netWealth - 1 : null;
    const grossReturn = periodReturns.length > 0 ? grossWealth - 1 : null;
    const evaluationPosition = { blockNumber: this.evaluationBlock, logIndex: END_OF_BLOCK };
    const agentWalletAtEvaluation = walletAsOf(bindings, evaluationPosition);
    const evaluationValuation = agentWalletAtEvaluation
      ? this.valuePortfolio(agentWalletAtEvaluation, evaluationPosition)
      : { navUsd8: 0n, stockUsd8: 0n, missingFeeds: [], negativeAssets: [] };
    recordValuationProblems(evaluationValuation, reasons);
    const ownerAtEvaluation = this.ownerAt(agent, evaluationPosition);
    const status = reasons.size === 0 ? "scored" : "unscoreable";

    return {
      schemaVersion: 1,
      chainId: this.cfg.chain.chainId,
      evaluationBlock: this.evaluationBlock,
      evaluationTimestamp: this.evaluationTimestamp,
      agentId: agent.agentId,
      ownerAtEvaluation,
      agentWalletAtEvaluation,
      agentURI: agent.agentURI,
      registeredBlock: agent.registeredBlock,
      registeredAt: agent.registeredAt,
      status,
      reasons: [...reasons].sort(),
      benchmark: { symbol: this.benchmark.symbol, source: "inferred" },
      scope: {
        scoreableTokenCount: this.cfg.scoreableTokens.length,
        canonicalTokenCount: this.cfg.canonicalStockTokens.length,
        coverageRatio: coverage.coverageRatio,
        scoredFlowUsd8: coverage.scoredUsd.toString(),
        totalFlowUsd8: coverage.totalUsd.toString(),
        unattributedTransfers,
        ambiguousTransfers,
        overlappingWalletBinding,
        entrySelectionBias: true,
        nativeAssetNavExcluded: true,
        gasAttribution: "direct-tx-sender-only",
      },
      metrics: {
        portfolioNavUsd8: evaluationValuation.navUsd8.toString(),
        netReturn,
        grossReturn,
        benchmarkReturn,
        alpha: netReturn === null || benchmarkReturn === null ? null : netReturn - benchmarkReturn,
        sharpe: annualizedRatio(periodReturns, elapsedSeconds),
        informationRatio: annualizedRatio(activeReturns, elapsedSeconds),
        maxDrawdown: maxDrawdown(series.map((point) => point.netWealthIndex)),
        turnover: averageCapital > 0 ? usdNumber(totalTradeUsd8) / averageCapital : null,
        capacityDecayBpsPerLog10Usd: capacityDecaySlope(
          tradeFacts.flatMap((trade) =>
            trade.scoreable && trade.notionalUsd8 !== null && trade.adverseBps !== null
              ? [
                  {
                    notionalUsd: usdNumber(trade.notionalUsd8),
                    adverseSlippageBps: trade.adverseBps,
                  },
                ]
              : [],
          ),
        ),
        timeInMarket:
          marketTime.totalSeconds > 0
            ? marketTime.inMarketSeconds / marketTime.totalSeconds
            : null,
        gasCostUsd8: totalGasUsd8.toString(),
        unassignedGasUsd8: unassignedGasUsd8.toString(),
        slippageCostUsd8: totalSlippageUsd8.toString(),
        scoredTradeCount: tradeFacts.filter((trade) => trade.scoreable).length,
      },
      series,
      recomputeCommand: `pnpm --filter @rhchain/metrics recompute --db <index.sqlite> --agent ${agent.agentId} --block ${this.evaluationBlock}`,
    };
  }

  private segmentPoints(segment: BindingSegment): Array<{
    position: ChainPosition;
    timestamp: number;
  }> {
    const points = [
      { position: segment.start, timestamp: segment.startTimestamp },
      ...this.cadenceBlocks
        .filter((block) => {
          const position = { blockNumber: block, logIndex: END_OF_BLOCK };
          return comparePosition(position, segment.start) > 0 && comparePosition(position, segment.end) < 0;
        })
        .map((block) => ({
          position: { blockNumber: block, logIndex: END_OF_BLOCK },
          timestamp: this.prices.timestamp(block)!,
        })),
      { position: segment.end, timestamp: segment.endTimestamp },
    ];
    const unique = new Map<string, (typeof points)[number]>();
    for (const point of points) {
      unique.set(`${point.position.blockNumber}:${point.position.logIndex}`, point);
    }
    return [...unique.values()].sort((a, b) => comparePosition(a.position, b.position));
  }

  private valuePortfolio(wallet: string, position: ChainPosition): Valuation {
    let navUsd8 = 0n;
    let stockUsd8 = 0n;
    const missingFeeds: string[] = [];
    const negativeAssets: string[] = [];
    for (const asset of this.assets.values()) {
      const balance = this.ledger.balance(wallet, asset.address, position);
      if (balance < 0n) {
        negativeAssets.push(asset.symbol);
        continue;
      }
      if (balance === 0n) continue;
      const snapshot = this.prices.asOf(asset.feedProxy, position.blockNumber);
      if (!snapshot) {
        missingFeeds.push(asset.symbol);
        continue;
      }
      const value = valueUsd8(balance, asset, BigInt(snapshot.answer));
      navUsd8 += value;
      if (asset.kind === "stock") stockUsd8 += value;
    }
    return { navUsd8, stockUsd8, missingFeeds, negativeAssets };
  }

  private priceAnswer(asset: AssetMeta, blockNumber: number): bigint | null {
    const snapshot = this.prices.asOf(asset.feedProxy, blockNumber);
    return snapshot ? normalizePrice(BigInt(snapshot.answer), asset.feedDecimals, USD_DECIMALS) : null;
  }

  private hasOverlappingBinding(agentId: string, segments: readonly BindingSegment[]): boolean {
    for (const other of this.agents) {
      if (other.agentId === agentId) continue;
      const otherSegments = buildBindingSegments(
        this.bindingsByAgent.get(other.agentId) ?? [],
        other.registeredBlock,
        this.evaluationBlock,
        this.evaluationTimestamp,
      );
      for (const segment of segments) {
        for (const candidate of otherSegments) {
          if (
            segment.wallet === candidate.wallet &&
            comparePosition(segment.start, candidate.end) <= 0 &&
            comparePosition(candidate.start, segment.end) <= 0
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private ownerAt(agent: AgentRow, position: ChainPosition): string {
    let owner = lc(agent.owner);
    for (const row of this.ownersByAgent.get(agent.agentId) ?? []) {
      if (!atOrBefore(row, position)) break;
      owner = row.owner;
    }
    return owner;
  }

  private timeInMarket(segments: readonly BindingSegment[]): {
    inMarketSeconds: number;
    totalSeconds: number;
  } {
    let inMarketSeconds = 0;
    let totalSeconds = 0;
    for (const segment of segments) {
      const changes = this.tokenRows
        .filter((row) => {
          const position = { blockNumber: row.blockNumber, logIndex: row.logIndex };
          return (
            this.assets.has(lc(row.token)) &&
            touchesOnly(segment.wallet, row.fromAddr, row.toAddr) &&
            comparePosition(position, segment.start) > 0 &&
            comparePosition(position, segment.end) <= 0
          );
        })
        .map((row) => ({
          position: { blockNumber: row.blockNumber, logIndex: row.logIndex },
          timestamp: row.blockTimestamp,
        }));
      const points = [
        { position: segment.start, timestamp: segment.startTimestamp },
        ...changes,
        { position: segment.end, timestamp: segment.endTimestamp },
      ].sort((a, b) => comparePosition(a.position, b.position));
      for (let i = 0; i < points.length - 1; i++) {
        const point = points[i]!;
        const next = points[i + 1]!;
        const duration = Math.max(0, next.timestamp - point.timestamp);
        totalSeconds += duration;
        if (this.valuePortfolio(segment.wallet, point.position).stockUsd8 > 0n) {
          inMarketSeconds += duration;
        }
      }
    }
    return { inMarketSeconds, totalSeconds };
  }
}

function buildBindingSegments(
  points: readonly BindingPoint[],
  registeredBlock: number,
  evaluationBlock: number,
  evaluationTimestamp: number,
): BindingSegment[] {
  const endPosition = { blockNumber: evaluationBlock, logIndex: END_OF_BLOCK };
  const relevant = points.filter(
    (point) => point.blockNumber >= registeredBlock && atOrBefore(point, endPosition),
  );
  const segments: BindingSegment[] = [];
  let wallet: string | null = null;
  let start: BindingPoint | null = null;
  for (const point of relevant) {
    if (point.wallet === wallet) continue;
    if (wallet && start) {
      segments.push({
        wallet,
        start,
        end: { blockNumber: point.blockNumber, logIndex: point.logIndex - 1 },
        startTimestamp: start.timestamp,
        endTimestamp: point.timestamp,
      });
    }
    wallet = point.wallet;
    start = wallet ? point : null;
  }
  if (wallet && start && atOrBefore(start, endPosition)) {
    segments.push({
      wallet,
      start,
      end: endPosition,
      startTimestamp: start.timestamp,
      endTimestamp: evaluationTimestamp,
    });
  }
  return segments.filter((segment) => comparePosition(segment.start, segment.end) <= 0);
}

function touchesOnly(wallet: string, from: string, to: string): boolean {
  const fromMatches = lc(from) === wallet;
  const toMatches = lc(to) === wallet;
  return fromMatches !== toMatches;
}

function rememberTxPosition(
  map: Map<string, ChainPosition>,
  txHash: string,
  position: ChainPosition,
): void {
  const existing = map.get(txHash);
  if (!existing || comparePosition(position, existing) < 0) map.set(txHash, position);
}

function normalizePrice(answer: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (answer <= 0n) throw new RangeError("price answer must be positive");
  if (fromDecimals === toDecimals) return answer;
  return fromDecimals < toDecimals
    ? answer * 10n ** BigInt(toDecimals - fromDecimals)
    : answer / 10n ** BigInt(fromDecimals - toDecimals);
}

function valueUsd8(rawBalance: bigint, asset: AssetMeta, feedAnswer: bigint): bigint {
  return rawBalanceValueUsd(rawBalance, feedAnswer, {
    tokenDecimals: asset.decimals,
    feedDecimals: asset.feedDecimals,
    outputDecimals: USD_DECIMALS,
  });
}

function signedTokenValueUsd8(rawAmount: bigint, signedPrice8: bigint, decimals: number): bigint {
  if (signedPrice8 === 0n) return 0n;
  const magnitude = rawBalanceValueUsd(rawAmount, abs(signedPrice8), {
    tokenDecimals: decimals,
    feedDecimals: USD_DECIMALS,
    outputDecimals: USD_DECIMALS,
  });
  return signedPrice8 < 0n ? -magnitude : magnitude;
}

function between<T extends ChainPosition>(
  rows: readonly T[],
  startExclusive: ChainPosition,
  endInclusive: ChainPosition,
): T[] {
  return rows.filter(
    (row) => comparePosition(row, startExclusive) > 0 && comparePosition(row, endInclusive) <= 0,
  );
}

function sumBigInt(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

function sumNumber(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function usdNumber(value: bigint): number {
  return Number(value) / 10 ** USD_DECIMALS;
}

function recordValuationProblems(valuation: Valuation, reasons: Set<string>): void {
  if (valuation.missingFeeds.length > 0) reasons.add("missing-nav-price");
  if (valuation.negativeAssets.length > 0) reasons.add("incomplete-transfer-history");
}

function makeNavPoint(
  point: { position: ChainPosition; timestamp: number },
  wallet: string,
  valuation: Valuation,
  segmentStart: boolean,
  netWealthIndex: number,
  grossWealthIndex: number,
  benchmarkWealthIndex: number,
): NavPoint {
  return {
    blockNumber: point.position.blockNumber,
    timestamp: point.timestamp,
    wallet,
    segmentStart,
    portfolioNavUsd8: valuation.navUsd8.toString(),
    stockExposureUsd8: valuation.stockUsd8.toString(),
    externalFlowUsd8: "0",
    gasCostUsd8: "0",
    slippageCostUsd8: "0",
    netPeriodReturn: null,
    grossPeriodReturn: null,
    benchmarkPeriodReturn: null,
    netWealthIndex,
    grossWealthIndex,
    benchmarkWealthIndex,
  };
}

function eventTimestamp(
  txHash: string,
  tokenRows: readonly TokenTransferRow[],
  cashRows: readonly CashTransferRow[],
  fallback: number,
): number {
  return (
    tokenRows.find((row) => row.txHash === txHash)?.blockTimestamp ??
    cashRows.find((row) => row.txHash === txHash)?.blockTimestamp ??
    fallback
  );
}
