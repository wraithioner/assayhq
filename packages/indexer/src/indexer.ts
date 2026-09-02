/**
 * The indexer orchestration. Reorg-safe, idempotent, resumable.
 *
 * Idempotent: every event write is `onConflictDoNothing` on (tx_hash, log_index),
 * so re-running any range is a no-op. Resumable: progress lives in indexer_state.
 * Reorg-aware: `followHead` verifies the stored tip still chains onto the
 * canonical head and rolls back event rows above the common ancestor before
 * re-indexing.
 *
 * Stores RAW events only; @assayhq/metrics derives NAV/returns/costs from them.
 */
import {
  createPublicClient,
  http,
  getAddress,
  zeroAddress,
  type PublicClient,
  type Address,
} from "viem";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "./db.js";
import type { IndexerConfig } from "./config.js";
import { robinhoodChain } from "./config.js";
import * as t from "./schema.js";
import {
  uniswapV3FactoryAbi,
  uniswapV3PoolAbi,
  chainlinkFeedAbi,
  evTransfer,
  evTransferWithScaledUI,
  evUIMultiplierUpdated,
  evRegistered,
  evMetadataSet,
  evNftTransfer,
  evSwap,
  evAnswerUpdated,
  UNIV3_FEE_TIERS,
} from "./abis.js";
import { attributeTransfers, type TransferRef, type SwapRef } from "./attribution.js";
import { decodeAgentWalletMetadata, ZERO_ADDRESS } from "./identity.js";
import { findCommonAncestor, type StoredBlock } from "./reorg.js";

const lc = (a: string) => a.toLowerCase();

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface IndexerOptions {
  /** Blocks kept as a reorg buffer below the head (public RH chain is fast). */
  reorgBuffer?: number;
  /** Max block span per getLogs call. */
  logChunk?: number;
  /** Deterministic Chainlink snapshot cadence (36,000 ≈ one hour at 100ms). */
  priceCadenceBlocks?: number;
  stateId?: string;
}

export interface SyncResult {
  headBlock: number;
  finalizedBlock: number;
  indexedFrom: number | null;
  indexedTo: number | null;
  rolledBackTo: number | null;
}

export class Indexer {
  readonly client: PublicClient;
  private readonly reorgBuffer: number;
  private readonly logChunk: number;
  private readonly priceCadenceBlocks: number;
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
    this.priceCadenceBlocks = opts.priceCadenceBlocks ?? 36_000;
    if (!Number.isSafeInteger(this.priceCadenceBlocks) || this.priceCadenceBlocks <= 0) {
      throw new RangeError("priceCadenceBlocks must be a positive integer");
    }
    this.stateId = opts.stateId ?? "main";
  }

  /** Seed every canonical Stock Token plus the two v1 quote assets. */
  seedTokens(): void {
    const scoreable = new Map(this.cfg.scoreableTokens.map((tk) => [lc(tk.address), tk]));
    for (const tk of this.cfg.canonicalStockTokens) {
      const covered = scoreable.get(lc(tk.address));
      this.db
        .insert(t.tokens)
        .values({
          address: lc(tk.address),
          symbol: tk.symbol,
          decimals: tk.decimals,
          feedProxy: covered ? lc(covered.feedProxy) : null,
          feedDecimals: covered?.feedDecimals ?? null,
          scoreable: covered !== undefined,
        })
        .onConflictDoUpdate({
          target: t.tokens.address,
          set: {
            symbol: tk.symbol,
            decimals: tk.decimals,
            feedProxy: covered ? lc(covered.feedProxy) : null,
            feedDecimals: covered?.feedDecimals ?? null,
            scoreable: covered !== undefined,
          },
        })
        .run();
    }
    for (const [symbol, quote] of Object.entries(this.cfg.quoteAssets)) {
      this.db
        .insert(t.tokens)
        .values({
          address: lc(quote.address),
          symbol,
          decimals: quote.decimals,
          feedProxy: lc(quote.feedProxy),
          feedDecimals: quote.feedDecimals,
          scoreable: false,
        })
        .onConflictDoUpdate({
          target: t.tokens.address,
          set: {
            symbol,
            decimals: quote.decimals,
            feedProxy: lc(quote.feedProxy),
            feedDecimals: quote.feedDecimals,
            scoreable: false,
          },
        })
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

  /** Fetch a fresh canonical header and persist it as a reorg checkpoint. */
  async recordHeader(n: number): Promise<StoredBlock> {
    const b = await this.client.getBlock({ blockNumber: BigInt(n), includeTransactions: false });
    if (!b.hash) throw new Error(`block ${n} has no hash`);
    const hdr: StoredBlock = { number: n, hash: b.hash, parentHash: b.parentHash };
    const timestamp = Number(b.timestamp);
    this.db
      .insert(t.blocks)
      .values({ number: n, hash: b.hash, parentHash: b.parentHash, timestamp })
      .onConflictDoUpdate({
        target: t.blocks.number,
        set: { hash: b.hash, parentHash: b.parentHash, timestamp },
      })
      .run();
    this.blockHdrCache.set(n, hdr);
    this.blockTsCache.set(n, timestamp);
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
    for (const tk of this.cfg.canonicalStockTokens) {
      for (const quote of Object.values(this.cfg.quoteAssets)) {
        for (const fee of UNIV3_FEE_TIERS) {
          const pool = (await this.client.readContract({
            address: getAddress(this.cfg.uniswapV3.factory),
            abi: uniswapV3FactoryAbi,
            functionName: "getPool",
            args: [getAddress(tk.address), getAddress(quote.address), fee],
          })) as Address;
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
              quoteToken: lc(quote.address),
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
            agentWallet: null,
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

      // ERC-8004's agentWallet is a cryptographically verified metadata field,
      // not necessarily the NFT owner. The implementation emits the packed
      // address in MetadataSet, including the initial binding at registration.
      const metadata = await this.client.getLogs({
        address: registry,
        event: evMetadataSet,
        fromBlock: f,
        toBlock: to,
      });
      for (const log of metadata) {
        const decoded = decodeAgentWalletMetadata(
          log.args.metadataKey as string,
          log.args.metadataValue as `0x${string}`,
        );
        if (decoded === undefined) continue;
        const ts = await this.blockTs(Number(log.blockNumber));
        const agentId = (log.args.agentId as bigint).toString();
        this.db
          .insert(t.agentWalletHistory)
          .values({
            agentId,
            wallet: decoded === null ? ZERO_ADDRESS : lc(decoded),
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
    this.refreshAgentSnapshots();
    return n;
  }

  async indexMultiplierUpdates(fromBlock: number, toBlock: number): Promise<number> {
    const tokens = this.cfg.canonicalStockTokens.map((x) => getAddress(x.address));
    let n = 0;
    for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
      for (const addresses of batches(tokens, 100)) {
        const logs = await this.client.getLogs({
          address: addresses,
          event: evUIMultiplierUpdated,
          fromBlock: f,
          toBlock: to,
        });
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
      for (const addresses of batches(addrs, 100)) {
        const logs = await this.client.getLogs({
          address: addresses,
          event: evSwap,
          fromBlock: f,
          toBlock: to,
        });
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
    }
    return n;
  }

  async indexPrices(fromBlock: number, toBlock: number): Promise<number> {
    let n = 0;
    const feeds = [
      ...this.cfg.scoreableTokens.map((tk) => ({ feedProxy: tk.feedProxy })),
      ...Object.values(this.cfg.quoteAssets).map((quote) => ({ feedProxy: quote.feedProxy })),
    ];
    const seenFeeds = new Set<string>();
    for (const tk of feeds) {
      if (seenFeeds.has(lc(tk.feedProxy))) continue;
      seenFeeds.add(lc(tk.feedProxy));
      const aggregator = (await this.client.readContract({
        address: getAddress(tk.feedProxy),
        abi: chainlinkFeedAbi,
        functionName: "aggregator",
      })) as Address;
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

  /**
   * Read each relevant Chainlink proxy at deterministic cadence blocks and at
   * every agent balance-change block. Proxy reads are deliberately used here:
   * they follow aggregator upgrades and make an event's scoring price exact.
   */
  async indexPriceSnapshots(fromBlock: number, toBlock: number): Promise<number> {
    const stockFeed = new Map(
      this.cfg.scoreableTokens.map((tk) => [lc(tk.address), getAddress(tk.feedProxy)]),
    );
    const quoteFeed = new Map(
      Object.values(this.cfg.quoteAssets).map((quote) => [
        lc(quote.address),
        getAddress(quote.feedProxy),
      ]),
    );
    const ethFeed = getAddress(this.cfg.quoteAssets.WETH.feedProxy);
    const allFeeds = [...new Set([...stockFeed.values(), ...quoteFeed.values()])];
    type SnapshotSource = "cadence" | "event" | "both";
    const requests = new Map<number, Map<string, SnapshotSource>>();
    const request = (block: number, feed: Address, source: "cadence" | "event") => {
      const atBlock = requests.get(block) ?? new Map<string, SnapshotSource>();
      const key = lc(feed);
      const previous = atBlock.get(key);
      atBlock.set(key, previous && previous !== source ? "both" : (previous ?? source));
      requests.set(block, atBlock);
    };

    const firstCadence = Math.ceil(fromBlock / this.priceCadenceBlocks) * this.priceCadenceBlocks;
    for (let block = firstCadence; block <= toBlock; block += this.priceCadenceBlocks) {
      for (const feed of allFeeds) request(block, feed, "cadence");
    }

    const tokenRows = this.db
      .select()
      .from(t.tokenTransfers)
      .where(and(gte(t.tokenTransfers.blockNumber, fromBlock), lte(t.tokenTransfers.blockNumber, toBlock)))
      .all();
    const cashRows = this.db
      .select()
      .from(t.cashTransfers)
      .where(and(gte(t.cashTransfers.blockNumber, fromBlock), lte(t.cashTransfers.blockNumber, toBlock)))
      .all();
    const bindingRows = this.db
      .select()
      .from(t.agentWalletHistory)
      .where(
        and(
          gte(t.agentWalletHistory.blockNumber, fromBlock),
          lte(t.agentWalletHistory.blockNumber, toBlock),
        ),
      )
      .all();
    const agentTxs = new Set([...tokenRows, ...cashRows].map((row) => row.txHash));
    const swapRows = this.db
      .select()
      .from(t.swaps)
      .where(and(gte(t.swaps.blockNumber, fromBlock), lte(t.swaps.blockNumber, toBlock)))
      .all()
      .filter((row) => agentTxs.has(row.txHash));

    for (const row of tokenRows) {
      const feed = stockFeed.get(lc(row.token));
      if (feed) request(row.blockNumber, feed, "event");
      request(row.blockNumber, ethFeed, "event"); // gas is native ETH
    }
    for (const row of cashRows) {
      const feed = quoteFeed.get(lc(row.token));
      if (feed) request(row.blockNumber, feed, "event");
      request(row.blockNumber, ethFeed, "event");
    }
    for (const row of bindingRows) {
      for (const feed of allFeeds) request(row.blockNumber, feed, "event");
    }
    for (const row of swapRows) {
      const feed = quoteFeed.get(lc(row.quoteToken));
      if (feed) request(row.blockNumber, feed, "event");
    }

    let n = 0;
    for (const [block, feeds] of [...requests.entries()].sort((a, b) => a[0] - b[0])) {
      const ts = await this.blockTs(block);
      for (const [feed, source] of feeds) {
        const [roundId, answer, , updatedAt] = (await this.client.readContract({
          address: getAddress(feed),
          abi: chainlinkFeedAbi,
          functionName: "latestRoundData",
          blockNumber: BigInt(block),
        })) as readonly [bigint, bigint, bigint, bigint, bigint];
        if (answer <= 0n || updatedAt === 0n) {
          throw new Error(`invalid Chainlink answer for ${feed} at block ${block}`);
        }
        const result = this.db
          .insert(t.priceSnapshots)
          .values({
            feedProxy: lc(feed),
            answer: answer.toString(),
            roundId: roundId.toString(),
            updatedAt: Number(updatedAt),
            blockNumber: block,
            blockTimestamp: ts,
            source,
          })
          .onConflictDoUpdate({
            target: [t.priceSnapshots.feedProxy, t.priceSnapshots.blockNumber],
            set: {
              answer: answer.toString(),
              roundId: roundId.toString(),
              updatedAt: Number(updatedAt),
              blockTimestamp: ts,
              source,
            },
          })
          .run();
        n += result.changes;
      }
    }
    return n;
  }

  async indexAgentTransfers(fromBlock: number, toBlock: number): Promise<number> {
    const walletSet = this.walletsEverBound();
    if (walletSet.size === 0) return 0;
    const walletArgs = batches([...walletSet].map((a) => getAddress(a)), 50);
    const tokenArgs = batches(
      this.cfg.canonicalStockTokens.map((tk) => getAddress(tk.address)),
      100,
    );
    const canonical = new Set(this.cfg.canonicalStockTokens.map((tk) => lc(tk.address)));
    const scoreable = new Set(this.cfg.scoreableTokens.map((tk) => lc(tk.address)));
    let n = 0;
    for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
      for (const addresses of tokenArgs) {
        for (const wallets of walletArgs) {
          for (const side of ["from", "to"] as const) {
            const logs = await this.client.getLogs({
              address: addresses,
              event: evTransferWithScaledUI,
              args: side === "from" ? { from: wallets } : { to: wallets },
              fromBlock: f,
              toBlock: to,
            });
            for (const log of logs) {
              const token = lc(log.address);
              if (!canonical.has(token)) continue;
              const from = lc(log.args.from as string);
              const toA = lc(log.args.to as string);
              if (!walletSet.has(from) && !walletSet.has(toA)) continue;
              const ts = await this.blockTs(Number(log.blockNumber));
              const result = this.db
                .insert(t.tokenTransfers)
                .values({
                  token,
                  fromAddr: from,
                  toAddr: toA,
                  rawValue: (log.args.value as bigint).toString(),
                  uiValue: (log.args.uiValue as bigint).toString(),
                  scoreable: scoreable.has(token),
                  blockNumber: Number(log.blockNumber),
                  blockTimestamp: ts,
                  txHash: log.transactionHash!,
                  logIndex: log.logIndex!,
                })
                .onConflictDoNothing()
                .run();
              n += result.changes;
            }
          }
        }
      }
    }
    return n;
  }

  private walletsEverBound(): Set<string> {
    return new Set(
      this.db
        .select({ wallet: t.agentWalletHistory.wallet })
        .from(t.agentWalletHistory)
        .all()
        .map((row) => lc(row.wallet))
        .filter((wallet) => wallet !== ZERO_ADDRESS),
    );
  }

  private refreshAgentSnapshots(): void {
    this.db.update(t.agents).set({ agentWallet: null }).run();
    const owners = this.db
      .select()
      .from(t.agentOwnerHistory)
      .orderBy(asc(t.agentOwnerHistory.blockNumber), asc(t.agentOwnerHistory.logIndex))
      .all();
    for (const row of owners) {
      this.db.update(t.agents).set({ owner: lc(row.owner) }).where(eqAgent(row.agentId)).run();
    }
    const wallets = this.db
      .select()
      .from(t.agentWalletHistory)
      .orderBy(asc(t.agentWalletHistory.blockNumber), asc(t.agentWalletHistory.logIndex))
      .all();
    for (const row of wallets) {
      this.db
        .update(t.agents)
        .set({ agentWallet: lc(row.wallet) === ZERO_ADDRESS ? null : lc(row.wallet) })
        .where(eqAgent(row.agentId))
        .run();
    }
  }

  /** Index USDG/WETH (the cash leg) Transfer events touching bound agent wallets. */
  async indexCashTransfers(fromBlock: number, toBlock: number): Promise<number> {
    const walletSet = this.walletsEverBound();
    if (walletSet.size === 0) return 0;
    const walletArgs = batches([...walletSet].map((a) => getAddress(a)), 50);
    const cashTokens = Object.values(this.cfg.quoteAssets).map((quote) => getAddress(quote.address));
    let n = 0;
    for await (const [f, to] of this.chunks(fromBlock, toBlock)) {
      for (const wallets of walletArgs) {
        for (const side of ["from", "to"] as const) {
          const logs = await this.client.getLogs({
            address: cashTokens,
            event: evTransfer,
            args: side === "from" ? { from: wallets } : { to: wallets },
            fromBlock: f,
            toBlock: to,
          });
          for (const log of logs) {
            const from = lc(log.args.from as string);
            const toA = lc(log.args.to as string);
            if (!walletSet.has(from) && !walletSet.has(toA)) continue;
            const ts = await this.blockTs(Number(log.blockNumber));
            const result = this.db
              .insert(t.cashTransfers)
              .values({
                token: lc(log.address),
                fromAddr: from,
                toAddr: toA,
                value: (log.args.value as bigint).toString(),
                blockNumber: Number(log.blockNumber),
                blockTimestamp: ts,
                txHash: log.transactionHash!,
                logIndex: log.logIndex!,
              })
              .onConflictDoNothing()
              .run();
            n += result.changes;
          }
        }
      }
    }
    return n;
  }

  /**
   * Fetch gas facts for the transactions that moved agent balances. `txFrom`
   * is the receipt's `from`; for ERC-4337 flows that is the bundler, not the
   * agent — the subsidy/paymaster caveat (/docs/RECON.md §7) is resolved in
   * @assayhq/metrics, which decides whether the agent actually bore the cost.
   */
  async indexTxGas(fromBlock: number, toBlock: number): Promise<number> {
    const rows = this.db
      .select({ txHash: t.tokenTransfers.txHash })
      .from(t.tokenTransfers)
      .where(and(gte(t.tokenTransfers.blockNumber, fromBlock), lte(t.tokenTransfers.blockNumber, toBlock)))
      .all();
    const cashRows = this.db
      .select({ txHash: t.cashTransfers.txHash })
      .from(t.cashTransfers)
      .where(and(gte(t.cashTransfers.blockNumber, fromBlock), lte(t.cashTransfers.blockNumber, toBlock)))
      .all();
    const seen = new Set<string>();
    let n = 0;
    for (const r of [...rows, ...cashRows]) {
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
          txFrom: lc(rcpt.from),
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
      .where(
        and(
          gte(t.tokenTransfers.blockNumber, fromBlock),
          lte(t.tokenTransfers.blockNumber, toBlock),
          eq(t.tokenTransfers.attributionStatus, "pending"),
        ),
      )
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
      fromAddr: r.fromAddr,
      toAddr: r.toAddr,
      rawValue: BigInt(r.rawValue),
    }));
    const srefs: SwapRef[] = swapsRows.map((s) => ({
      id: s.id,
      txHash: s.txHash,
      stockToken: s.stockToken,
      logIndex: s.logIndex,
      pool: s.pool,
      stockAmount: BigInt(s.stockAmount),
    }));
    const matched = attributeTransfers(trefs, srefs);
    for (const r of transfers) {
      const result = matched.get(`${r.txHash}:${r.logIndex}`);
      if (!result) continue;
      this.db
        .update(t.tokenTransfers)
        .set({
          attributedSwapId: result.swapId,
          attributionStatus: result.status,
          attributionMethod: result.method,
        })
        .where(eqTransferId(r.id))
        .run();
    }
  }

  // ---- orchestration -----------------------------------------------------

  /** Index a finalized [fromBlock, toBlock] range through every stage. */
  async indexRange(fromBlock: number, toBlock: number): Promise<void> {
    if (fromBlock > toBlock) return;
    await this.indexAgents(fromBlock, toBlock);
    await this.indexMultiplierUpdates(fromBlock, toBlock);
    await this.indexPrices(fromBlock, toBlock);
    await this.indexSwaps(fromBlock, toBlock);
    await this.indexAgentTransfers(fromBlock, toBlock);
    await this.indexCashTransfers(fromBlock, toBlock);
    await this.indexTxGas(fromBlock, toBlock);
    this.attribute(fromBlock, toBlock);
    await this.indexPriceSnapshots(fromBlock, toBlock);
  }

  /**
   * Advance the stored stream to `head - reorgBuffer` exactly once.
   *
   * On a tip mismatch, compare the stored checkpoint/event headers inside the
   * buffer to fresh canonical headers, roll back to the highest common one, and
   * persist that rollback cursor before re-indexing. If the oldest checkpoint
   * also diverged, fail closed: an operator must resync from a known checkpoint.
   */
  async syncOnce(startBlock?: number): Promise<SyncResult> {
    const headBlock = Number(await this.client.getBlockNumber());
    const finalizedBlock = Math.max(0, headBlock - this.reorgBuffer);
    const state = this.getState();

    if (!state) {
      if (startBlock === undefined || !Number.isSafeInteger(startBlock) || startBlock < 0) {
        throw new Error("first sync requires a non-negative startBlock");
      }
      if (finalizedBlock < startBlock) {
        return {
          headBlock,
          finalizedBlock,
          indexedFrom: null,
          indexedTo: null,
          rolledBackTo: null,
        };
      }
      await this.indexRange(startBlock, finalizedBlock);
      const tip = await this.recordHeader(finalizedBlock);
      const anchor = Math.max(startBlock, finalizedBlock - this.reorgBuffer);
      if (anchor !== finalizedBlock) await this.recordHeader(anchor);
      this.setState(finalizedBlock, tip.hash, finalizedBlock, startBlock);
      return {
        headBlock,
        finalizedBlock,
        indexedFrom: startBlock,
        indexedTo: finalizedBlock,
        rolledBackTo: null,
      };
    }

    const streamStart = state.startBlock;
    let indexedFrom = state.lastBlock + 1;
    let rolledBackTo: number | null = null;

    if (state.lastBlock >= streamStart) {
      const canonicalTip = await this.client.getBlock({
        blockNumber: BigInt(state.lastBlock),
        includeTransactions: false,
      });
      const storedHash = state.lastBlockHash?.toLowerCase();
      if (!canonicalTip.hash || !storedHash || canonicalTip.hash.toLowerCase() !== storedHash) {
        const ancestor = await this.findCanonicalAncestor(state.lastBlock, streamStart);
        this.rollbackAbove(ancestor);
        this.blockHdrCache.clear();
        this.blockTsCache.clear();
        const ancestorHeader =
          ancestor >= 0 ? await this.recordHeader(ancestor) : { hash: "", number: -1, parentHash: "" };
        this.setState(ancestor, ancestorHeader.hash, ancestor, streamStart);
        indexedFrom = ancestor + 1;
        rolledBackTo = ancestor;
      }
    }

    if (finalizedBlock < indexedFrom) {
      return {
        headBlock,
        finalizedBlock,
        indexedFrom: null,
        indexedTo: null,
        rolledBackTo,
      };
    }

    await this.indexRange(indexedFrom, finalizedBlock);
    const tip = await this.recordHeader(finalizedBlock);
    const anchor = Math.max(streamStart, finalizedBlock - this.reorgBuffer);
    if (anchor !== finalizedBlock) await this.recordHeader(anchor);
    this.setState(finalizedBlock, tip.hash, finalizedBlock, streamStart);
    return {
      headBlock,
      finalizedBlock,
      indexedFrom,
      indexedTo: finalizedBlock,
      rolledBackTo,
    };
  }

  private async findCanonicalAncestor(lastBlock: number, startBlock: number): Promise<number> {
    const oldest = Math.max(startBlock, lastBlock - this.reorgBuffer);
    const storedRows = this.db
      .select()
      .from(t.blocks)
      .where(and(gte(t.blocks.number, oldest), lte(t.blocks.number, lastBlock)))
      .orderBy(desc(t.blocks.number))
      .all();

    if (storedRows.length === 0) {
      throw new Error(
        `cannot recover reorg: no stored header in [${oldest}, ${lastBlock}]; resync required`,
      );
    }

    const canonical = new Map<number, string>();
    for (const row of storedRows) {
      const block = await this.client.getBlock({
        blockNumber: BigInt(row.number),
        includeTransactions: false,
      });
      if (block.hash) canonical.set(row.number, block.hash);
    }
    const ancestor = findCommonAncestor(storedRows, (n) => canonical.get(n));
    if (ancestor >= 0) return ancestor;

    // If the whole indexed span fits inside the buffer, re-indexing from its
    // beginning is safe even when the first indexed block itself was replaced.
    if (oldest === startBlock && lastBlock - startBlock <= this.reorgBuffer) return startBlock - 1;
    throw new Error(
      `reorg exceeds ${this.reorgBuffer}-block buffer (no common header in [${oldest}, ${lastBlock}]); resync required`,
    );
  }

  /** Roll back all event rows strictly above `block` (used after a reorg). */
  rollbackAbove(block: number): void {
    const tables = [
      t.agentOwnerHistory,
      t.agentWalletHistory,
      t.tokenTransfers,
      t.cashTransfers,
      t.swaps,
      t.multiplierUpdates,
      t.priceUpdates,
      t.priceSnapshots,
      t.txGas,
    ] as const;
    for (const tbl of tables) {
      this.db.delete(tbl).where(gte(tbl.blockNumber, block + 1)).run();
    }
    this.db.delete(t.agents).where(gte(t.agents.registeredBlock, block + 1)).run();
    this.refreshAgentSnapshots();
    this.db.delete(t.blocks).where(gte(t.blocks.number, block + 1)).run();
    for (const key of this.blockHdrCache.keys()) {
      if (key > block) this.blockHdrCache.delete(key);
    }
    for (const key of this.blockTsCache.keys()) {
      if (key > block) this.blockTsCache.delete(key);
    }
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

function eqAgent(agentId: string) {
  return eq(t.agents.agentId, agentId);
}
function eqTransferId(id: number) {
  return eq(t.tokenTransfers.id, id);
}
