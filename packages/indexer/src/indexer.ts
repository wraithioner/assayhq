/**
 * The indexer orchestration. Reorg-safe, idempotent, resumable.
 *
 * Idempotent: every event write is `onConflictDoNothing` on (tx_hash, log_index),
 * so re-running any range is a no-op. Resumable: progress lives in indexer_state.
 * Reorg-aware: `followHead` verifies the stored tip still chains onto the
 * canonical head and rolls back event rows above the common ancestor before
 * re-indexing.
 *
 * Stores RAW events only; @rhchain/metrics derives NAV/returns/costs from them.
 */
import {
  createPublicClient,
  http,
  getAddress,
  zeroAddress,
  type PublicClient,
  type Address,
} from "viem";
import { and, gte, lte, isNull } from "drizzle-orm";
import type { Db } from "./db.js";
import type { IndexerConfig } from "./config.js";
import { robinhoodChain, scoreableByAddress, quoteAssets } from "./config.js";
import * as t from "./schema.js";
import {
  uniswapV3FactoryAbi,
  uniswapV3PoolAbi,
  chainlinkFeedAbi,
  evTransfer,
  evTransferWithScaledUI,
  evUIMultiplierUpdated,
  evRegistered,
  evNftTransfer,
  evSwap,
  evAnswerUpdated,
  UNIV3_FEE_TIERS,
} from "./abis.js";
import { attributeTransfers, type TransferRef, type SwapRef } from "./attribution.js";
import { findCommonAncestor, type StoredBlock } from "./reorg.js";

const lc = (a: string) => a.toLowerCase();

export interface IndexerOptions {
  /** Blocks kept as a reorg buffer below the head (public RH chain is fast). */
  reorgBuffer?: number;
  /** Max block span per getLogs call. */
  logChunk?: number;
  stateId?: string;
}

export class Indexer {
  readonly client: PublicClient;
  private readonly reorgBuffer: number;
  private readonly logChunk: number;
  private readonly stateId: string;
  private readonly blockTsCache = new Map<number, number>();
  private readonly blockHdrCache = new Map<number, StoredBlock>();

  constructor(
    private readonly db: Db,
    private readonly cfg: IndexerConfig,
    client?: PublicClient,
    opts: IndexerOptions = {},
  ) {
    this.client =
      client ??
      (createPublicClient({ chain: robinhoodChain, transport: http() }) as PublicClient);
    this.reorgBuffer = opts.reorgBuffer ?? 64;
    this.logChunk = opts.logChunk ?? 2000;
    this.stateId = opts.stateId ?? "main";
  }

  /** Seed the 35 scoreable tokens. Idempotent. */
  seedTokens(): void {
    for (const tk of this.cfg.scoreableTokens) {
      this.db
        .insert(t.tokens)
        .values({
          address: lc(tk.address),
          symbol: tk.symbol,
          decimals: tk.decimals,
          feedProxy: lc(tk.feedProxy),
          feedDecimals: tk.feedDecimals,
          scoreable: true,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  // ---- block headers / timestamps ---------------------------------------

  private async getHeader(n: number): Promise<StoredBlock> {
    const cached = this.blockHdrCache.get(n);
    if (cached) return cached;
    const b = await this.client.getBlock({ blockNumber: BigInt(n), includeTransactions: false });
    const hdr: StoredBlock = { number: n, hash: b.hash!, parentHash: b.parentHash };
    this.blockHdrCache.set(n, hdr);
    this.blockTsCache.set(n, Number(b.timestamp));
    this.db
      .insert(t.blocks)
      .values({ number: n, hash: b.hash!, parentHash: b.parentHash, timestamp: Number(b.timestamp) })
      .onConflictDoNothing()
      .run();
    return hdr;
  }

  private async blockTs(n: number): Promise<number> {
    const c = this.blockTsCache.get(n);
    if (c !== undefined) return c;
    await this.getHeader(n);
    return this.blockTsCache.get(n)!;
  }

  // ---- pool discovery (call-based; no launch-era log scan needed) --------

  async discoverPools(): Promise<number> {
    let found = 0;
    for (const tk of this.cfg.scoreableTokens) {
      for (const quote of [this.cfg.stablecoins.USDG, this.cfg.stablecoins.WETH]) {
        for (const fee of UNIV3_FEE_TIERS) {
          let pool: Address;
          try {
            pool = (await this.client.readContract({
              address: getAddress(this.cfg.uniswapV3.factory),
              abi: uniswapV3FactoryAbi,
              functionName: "getPool",
              args: [getAddress(tk.address), getAddress(quote), fee],
            })) as Address;
          } catch {
            continue;
          }
          if (!pool || lc(pool) === lc(zeroAddress)) continue;
          const [token0, token1] = await Promise.all([
            this.client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: "token0" }),
            this.client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: "token1" }),
          ]);
          this.db
            .insert(t.uniPools)
            .values({
              address: lc(pool),
              token0: lc(token0 as string),
              token1: lc(token1 as string),
              fee,
              stockToken: lc(tk.address),
              quoteToken: lc(quote),
              createdBlock: 0,
            })
            .onConflictDoNothing()
            .run();
          found++;
        }
      }
    }
    return found;
  }

  // ---- log stages --------------------------------------------------------

  private async *chunks(fromBlock: number, toBlock: number): AsyncGenerator<[bigint, bigint]> {
    for (let f = fromBlock; f <= toBlock; f += this.logChunk) {
      const to = Math.min(f + this.logChunk - 1, toBlock);
      yield [BigInt(f), BigInt(to)];
    }
  }

  async indexAgents(fromBlock: number, toBlock: number): Promise<number> {
    const registry = getAddress(this.cfg.erc8004.identityRegistry);
    let n = 0;
    for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
      const regs = await this.client.getLogs({ address: registry, event: evRegistered, fromBlock: f, toBlock: to });
      for (const log of regs) {
        const ts = await this.blockTs(Number(log.blockNumber));
        const agentId = (log.args.agentId as bigint).toString();
        const owner = lc(log.args.owner as string);
        this.db
          .insert(t.agents)
          .values({
            agentId,
            owner,
            agentURI: (log.args.agentURI as string) ?? "",
            registeredBlock: Number(log.blockNumber),
            registeredAt: ts,
            registeredTx: log.transactionHash!,
          })
          .onConflictDoNothing()
          .run();
        this.db
          .insert(t.agentOwnerHistory)
          .values({
            agentId,
            owner,
            blockNumber: Number(log.blockNumber),
            blockTimestamp: ts,
            txHash: log.transactionHash!,
            logIndex: log.logIndex!,
          })
          .onConflictDoNothing()
          .run();
        n++;
      }
      // NFT ownership transfers (wallet rotation), excluding the mint (from == 0).
      const xfers = await this.client.getLogs({ address: registry, event: evNftTransfer, fromBlock: f, toBlock: to });
      for (const log of xfers) {
        if (lc(log.args.from as string) === lc(zeroAddress)) continue;
        const ts = await this.blockTs(Number(log.blockNumber));
        const agentId = (log.args.tokenId as bigint).toString();
        const owner = lc(log.args.to as string);
        this.db
          .insert(t.agentOwnerHistory)
          .values({
            agentId,
            owner,
            blockNumber: Number(log.blockNumber),
            blockTimestamp: ts,
            txHash: log.transactionHash!,
            logIndex: log.logIndex!,
          })
          .onConflictDoNothing()
          .run();
        this.db.update(t.agents).set({ owner }).where(eqAgent(agentId)).run();
      }
    }
    return n;
  }

  async indexMultiplierUpdates(fromBlock: number, toBlock: number): Promise<number> {
    const tokens = this.cfg.scoreableTokens.map((x) => getAddress(x.address));
    let n = 0;
    for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
      const logs = await this.client.getLogs({ address: tokens, event: evUIMultiplierUpdated, fromBlock: f, toBlock: to });
      for (const log of logs) {
        this.db
          .insert(t.multiplierUpdates)
          .values({
            token: lc(log.address),
            oldMultiplier: (log.args.oldMultiplier as bigint).toString(),
            newMultiplier: (log.args.newMultiplier as bigint).toString(),
            effectiveAt: Number(log.args.effectiveAtTimestamp as bigint),
            blockNumber: Number(log.blockNumber),
            txHash: log.transactionHash!,
            logIndex: log.logIndex!,
          })
          .onConflictDoNothing()
          .run();
        n++;
      }
    }
    return n;
  }

  async indexSwaps(fromBlock: number, toBlock: number): Promise<number> {
    const pools = this.db.select().from(t.uniPools).all();
    if (pools.length === 0) return 0;
    const byAddr = new Map(pools.map((p) => [lc(p.address), p]));
    const addrs = pools.map((p) => getAddress(p.address));
    let n = 0;
    for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
      const logs = await this.client.getLogs({ address: addrs, event: evSwap, fromBlock: f, toBlock: to });
      for (const log of logs) {
        const pool = byAddr.get(lc(log.address));
        if (!pool) continue;
        const ts = await this.blockTs(Number(log.blockNumber));
        const amount0 = log.args.amount0 as bigint;
        const amount1 = log.args.amount1 as bigint;
        const token0IsStock = lc(pool.token0) === lc(pool.stockToken);
        const stockAmount = token0IsStock ? amount0 : amount1;
        const quoteAmount = token0IsStock ? amount1 : amount0;
        this.db
          .insert(t.swaps)
          .values({
            pool: lc(pool.address),
            stockToken: lc(pool.stockToken),
            quoteToken: lc(pool.quoteToken),
            stockAmount: stockAmount.toString(),
            quoteAmount: quoteAmount.toString(),
            sender: lc(log.args.sender as string),
            recipient: lc(log.args.recipient as string),
            blockNumber: Number(log.blockNumber),
            blockTimestamp: ts,
            txHash: log.transactionHash!,
            logIndex: log.logIndex!,
          })
          .onConflictDoNothing()
          .run();
        n++;
      }
    }
    return n;
  }

  async indexPrices(fromBlock: number, toBlock: number): Promise<number> {
    let n = 0;
    for (const tk of this.cfg.scoreableTokens) {
      let aggregator: Address;
      try {
        aggregator = (await this.client.readContract({
          address: getAddress(tk.feedProxy),
          abi: chainlinkFeedAbi,
          functionName: "aggregator",
        })) as Address;
      } catch {
        continue; // proxy without aggregator() — skip; price backfill can use latestRoundData snapshots
      }
      for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
        const logs = await this.client.getLogs({ address: aggregator, event: evAnswerUpdated, fromBlock: f, toBlock: to });
        for (const log of logs) {
          this.db
            .insert(t.priceUpdates)
            .values({
              feedProxy: lc(tk.feedProxy),
              aggregator: lc(aggregator),
              answer: (log.args.current as bigint).toString(),
              roundId: (log.args.roundId as bigint).toString(),
              updatedAt: Number(log.args.updatedAt as bigint),
              blockNumber: Number(log.blockNumber),
              txHash: log.transactionHash!,
              logIndex: log.logIndex!,
            })
            .onConflictDoNothing()
            .run();
          n++;
        }
      }
    }
    return n;
  }

  async indexAgentTransfers(fromBlock: number, toBlock: number): Promise<number> {
    const agents = this.db.select().from(t.agents).all();
    if (agents.length === 0) return 0;
    const walletSet = new Set(agents.map((a) => lc(a.owner)));
    const walletArg = [...walletSet].map((a) => getAddress(a)) as Address[];
    let n = 0;
    for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
      for (const side of ["from", "to"] as const) {
        const logs = await this.client.getLogs({
          event: evTransferWithScaledUI,
          args: side === "from" ? { from: walletArg } : { to: walletArg },
          fromBlock: f,
          toBlock: to,
        });
        for (const log of logs) {
          const token = lc(log.address);
          const from = lc(log.args.from as string);
          const toA = lc(log.args.to as string);
          const agentWallet = side === "from" ? from : toA;
          if (!walletSet.has(agentWallet)) continue;
          const ts = await this.blockTs(Number(log.blockNumber));
          this.db
            .insert(t.tokenTransfers)
            .values({
              token,
              fromAddr: from,
              toAddr: toA,
              rawValue: (log.args.value as bigint).toString(),
              uiValue: (log.args.uiValue as bigint).toString(),
              agentWallet,
              direction: side === "from" ? "out" : "in",
              scoreable: scoreableByAddress.has(token),
              blockNumber: Number(log.blockNumber),
              blockTimestamp: ts,
              txHash: log.transactionHash!,
              logIndex: log.logIndex!,
            })
            .onConflictDoNothing()
            .run();
          n++;
        }
      }
    }
    return n;
  }

  /** Index USDG/WETH (the cash leg) Transfer events touching agent wallets. */
  async indexCashTransfers(fromBlock: number, toBlock: number): Promise<number> {
    const agents = this.db.select().from(t.agents).all();
    if (agents.length === 0) return 0;
    const walletSet = new Set(agents.map((a) => lc(a.owner)));
    const walletArg = [...walletSet].map((a) => getAddress(a)) as Address[];
    const cashTokens = [getAddress(this.cfg.stablecoins.USDG), getAddress(this.cfg.stablecoins.WETH)];
    let n = 0;
    for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
      for (const side of ["from", "to"] as const) {
        const logs = await this.client.getLogs({
          address: cashTokens,
          event: evTransfer,
          args: side === "from" ? { from: walletArg } : { to: walletArg },
          fromBlock: f,
          toBlock: to,
        });
        for (const log of logs) {
          const from = lc(log.args.from as string);
          const toA = lc(log.args.to as string);
          const agentWallet = side === "from" ? from : toA;
          if (!walletSet.has(agentWallet)) continue;
          const ts = await this.blockTs(Number(log.blockNumber));
          this.db
            .insert(t.cashTransfers)
            .values({
              token: lc(log.address),
              fromAddr: from,
              toAddr: toA,
              value: (log.args.value as bigint).toString(),
              agentWallet,
              direction: side === "from" ? "out" : "in",
              blockNumber: Number(log.blockNumber),
              blockTimestamp: ts,
              txHash: log.transactionHash!,
              logIndex: log.logIndex!,
            })
            .onConflictDoNothing()
            .run();
          n++;
        }
      }
    }
    return n;
  }

  /**
   * Fetch gas facts for the transactions that moved agent balances. `feePayer`
   * is the receipt's `from`; for ERC-4337 flows that is the bundler, not the
   * agent — the subsidy/paymaster caveat (/docs/RECON.md §7) is resolved in
   * @rhchain/metrics, which decides whether the agent actually bore the cost.
   */
  async indexTxGas(fromBlock: number, toBlock: number): Promise<number> {
    const rows = this.db
      .select({ txHash: t.tokenTransfers.txHash })
      .from(t.tokenTransfers)
      .where(and(gte(t.tokenTransfers.blockNumber, fromBlock), lte(t.tokenTransfers.blockNumber, toBlock)))
      .all();
    const seen = new Set<string>();
    let n = 0;
    for (const r of rows) {
      if (seen.has(r.txHash)) continue;
      seen.add(r.txHash);
      const rcpt = await this.client.getTransactionReceipt({ hash: r.txHash as `0x${string}` });
      this.db
        .insert(t.txGas)
        .values({
          txHash: r.txHash,
          blockNumber: Number(rcpt.blockNumber),
          gasUsed: rcpt.gasUsed.toString(),
          effectiveGasPrice: rcpt.effectiveGasPrice.toString(),
          feePayer: lc(rcpt.from),
        })
        .onConflictDoNothing()
        .run();
      n++;
    }
    return n;
  }

  /** Match stored agent transfers to stored swaps in the same range. */
  attribute(fromBlock: number, toBlock: number): void {
    const transfers = this.db
      .select()
      .from(t.tokenTransfers)
      .where(and(gte(t.tokenTransfers.blockNumber, fromBlock), lte(t.tokenTransfers.blockNumber, toBlock), isNull(t.tokenTransfers.attributedSwapId)))
      .all();
    const swapsRows = this.db
      .select()
      .from(t.swaps)
      .where(and(gte(t.swaps.blockNumber, fromBlock), lte(t.swaps.blockNumber, toBlock)))
      .all();
    const trefs: TransferRef[] = transfers.map((r) => ({
      key: `${r.txHash}:${r.logIndex}`,
      txHash: r.txHash,
      token: r.token,
      logIndex: r.logIndex,
    }));
    const srefs: SwapRef[] = swapsRows.map((s) => ({
      id: s.id,
      txHash: s.txHash,
      stockToken: s.stockToken,
      logIndex: s.logIndex,
    }));
    const matched = attributeTransfers(trefs, srefs);
    for (const r of transfers) {
      const swapId = matched.get(`${r.txHash}:${r.logIndex}`);
      if (swapId != null) {
        this.db.update(t.tokenTransfers).set({ attributedSwapId: swapId }).where(eqTransferId(r.id)).run();
      }
    }
  }

  // ---- orchestration -----------------------------------------------------

  /** Index a finalized [fromBlock, toBlock] range through every stage. */
  async indexRange(fromBlock: number, toBlock: number): Promise<void> {
    await this.indexAgents(fromBlock, toBlock);
    await this.indexMultiplierUpdates(fromBlock, toBlock);
    await this.indexPrices(fromBlock, toBlock);
    await this.indexSwaps(fromBlock, toBlock);
    await this.indexAgentTransfers(fromBlock, toBlock);
    await this.indexCashTransfers(fromBlock, toBlock);
    await this.indexTxGas(fromBlock, toBlock);
    this.attribute(fromBlock, toBlock);
  }

  /** Roll back all event rows strictly above `block` (used after a reorg). */
  rollbackAbove(block: number): void {
    const tables = [
      t.agentOwnerHistory,
      t.tokenTransfers,
      t.cashTransfers,
      t.swaps,
      t.multiplierUpdates,
      t.priceUpdates,
      t.txGas,
    ] as const;
    for (const tbl of tables) {
      this.db.delete(tbl).where(gte(tbl.blockNumber, block + 1)).run();
    }
    this.db.delete(t.blocks).where(gte(t.blocks.number, block + 1)).run();
  }

  getState(): typeof t.indexerState.$inferSelect | undefined {
    return this.db.select().from(t.indexerState).all().find((s) => s.id === this.stateId);
  }

  setState(lastBlock: number, lastBlockHash: string, finalizedBlock: number, startBlock: number): void {
    this.db
      .insert(t.indexerState)
      .values({
        id: this.stateId,
        lastBlock,
        lastBlockHash,
        finalizedBlock,
        startBlock,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .onConflictDoUpdate({
        target: t.indexerState.id,
        set: { lastBlock, lastBlockHash, finalizedBlock, updatedAt: Math.floor(Date.now() / 1000) },
      })
      .run();
  }
}

// drizzle where-helpers kept local to avoid importing eq at top for one use each
import { eq } from "drizzle-orm";
function eqAgent(agentId: string) {
  return eq(t.agents.agentId, agentId);
}
function eqTransferId(id: number) {
  return eq(t.tokenTransfers.id, id);
}
