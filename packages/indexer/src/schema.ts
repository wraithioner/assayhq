/**
 * SQLite schema (Drizzle). Design rules:
 * - Store RAW events; derive everything else (metrics live in @rhchain/metrics).
 * - Token amounts exceed 64-bit, so bigints are stored as decimal TEXT.
 * - Block numbers and unix timestamps fit in SQLite integers.
 * - Every event row is keyed by (txHash, logIndex) for idempotent upserts and
 *   clean reorg rollback by block number.
 */
import { sqliteTable, text, integer, primaryKey, index, unique } from "drizzle-orm/sqlite-core";

/** Indexer progress cursor (single row per named stream). */
export const indexerState = sqliteTable("indexer_state", {
  id: text("id").primaryKey(), // e.g. "main"
  lastBlock: integer("last_block").notNull().default(0),
  lastBlockHash: text("last_block_hash"),
  finalizedBlock: integer("finalized_block").notNull().default(0),
  startBlock: integer("start_block").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

/** Block headers we've touched — for reorg detection and block->timestamp. */
export const blocks = sqliteTable("blocks", {
  number: integer("number").primaryKey(),
  hash: text("hash").notNull(),
  parentHash: text("parent_hash").notNull(),
  timestamp: integer("timestamp").notNull(),
});

/** Known tokens. scoreable=1 for the 35 feed-covered tokens; others discovered lazily. */
export const tokens = sqliteTable("tokens", {
  address: text("address").primaryKey(), // lower-cased
  symbol: text("symbol"),
  decimals: integer("decimals").notNull().default(18),
  feedProxy: text("feed_proxy"),
  feedDecimals: integer("feed_decimals"),
  scoreable: integer("scoreable", { mode: "boolean" }).notNull().default(false),
});

/** ERC-8004 agent identities. The scored wallet is the current NFT owner. */
export const agents = sqliteTable("agents", {
  agentId: text("agent_id").primaryKey(),
  owner: text("owner").notNull(), // lower-cased; current owner of the AgentIdentity NFT
  agentURI: text("agent_uri"),
  registeredBlock: integer("registered_block").notNull(),
  registeredAt: integer("registered_at").notNull(), // unix seconds — the scoring start
  registeredTx: text("registered_tx").notNull(),
});

/**
 * Ownership transfers of an AgentIdentity NFT (a "wallet rotation"). The current
 * owner is the latest by (block, logIndex). Kept so identity is fully
 * log-derivable and survivorship can cluster rotated wallets under agentId.
 */
export const agentOwnerHistory = sqliteTable(
  "agent_owner_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: text("agent_id").notNull(),
    owner: text("owner").notNull(),
    blockNumber: integer("block_number").notNull(),
    blockTimestamp: integer("block_timestamp").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => ({
    uq: unique().on(t.txHash, t.logIndex),
    byAgent: index("aoh_agent_idx").on(t.agentId, t.blockNumber),
  }),
);

/** Stock-token movements that touch an agent wallet (raw + underlying-share value). */
export const tokenTransfers = sqliteTable(
  "token_transfers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token").notNull(),
    fromAddr: text("from_addr").notNull(),
    toAddr: text("to_addr").notNull(),
    rawValue: text("raw_value").notNull(), // decimal string
    uiValue: text("ui_value").notNull(), // underlying shares, from TransferWithScaledUI
    agentWallet: text("agent_wallet").notNull(), // the agent wallet on one side
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    scoreable: integer("scoreable", { mode: "boolean" }).notNull(),
    blockNumber: integer("block_number").notNull(),
    blockTimestamp: integer("block_timestamp").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    /** Set once attribution runs: the swaps.id this transfer was matched to, or null (unattributed). */
    attributedSwapId: integer("attributed_swap_id"),
  },
  (t) => ({
    uq: unique().on(t.txHash, t.logIndex),
    byAgent: index("tt_agent_idx").on(t.agentWallet, t.blockNumber),
    byTx: index("tt_tx_idx").on(t.txHash),
  }),
);

/** Uniswap V3 pools involving a scoreable token and a quote asset (USDG/WETH). */
export const uniPools = sqliteTable("uni_pools", {
  address: text("address").primaryKey(),
  token0: text("token0").notNull(),
  token1: text("token1").notNull(),
  fee: integer("fee").notNull(),
  stockToken: text("stock_token").notNull(),
  quoteToken: text("quote_token").notNull(),
  createdBlock: integer("created_block").notNull(),
});

/** Uniswap V3 swaps on indexed pools. execPrice is USD-quote per 1e18 raw token. */
export const swaps = sqliteTable(
  "swaps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pool: text("pool").notNull(),
    stockToken: text("stock_token").notNull(),
    quoteToken: text("quote_token").notNull(),
    stockAmount: text("stock_amount").notNull(), // signed decimal string (pool perspective)
    quoteAmount: text("quote_amount").notNull(), // signed decimal string
    sender: text("sender").notNull(),
    recipient: text("recipient").notNull(),
    blockNumber: integer("block_number").notNull(),
    blockTimestamp: integer("block_timestamp").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => ({
    uq: unique().on(t.txHash, t.logIndex),
    byTx: index("swap_tx_idx").on(t.txHash),
  }),
);

/** UIMultiplierUpdated (corporate actions) per token. */
export const multiplierUpdates = sqliteTable(
  "multiplier_updates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token").notNull(),
    oldMultiplier: text("old_multiplier").notNull(),
    newMultiplier: text("new_multiplier").notNull(),
    effectiveAt: integer("effective_at").notNull(),
    blockNumber: integer("block_number").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => ({ uq: unique().on(t.txHash, t.logIndex) }),
);

/** Chainlink price updates (AnswerUpdated on the aggregator behind each feed proxy). */
export const priceUpdates = sqliteTable(
  "price_updates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedProxy: text("feed_proxy").notNull(), // canonical feed key
    aggregator: text("aggregator").notNull(),
    answer: text("answer").notNull(), // decimal string (feedDecimals)
    roundId: text("round_id").notNull(),
    updatedAt: integer("updated_at").notNull(), // unix seconds — used for as-of lookup
    blockNumber: integer("block_number").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => ({
    uq: unique().on(t.txHash, t.logIndex),
    byFeedTime: index("pu_feed_time_idx").on(t.feedProxy, t.updatedAt),
  }),
);

/** Per-transaction gas, for cost accounting (and the subsidy/paymaster caveat). */
export const txGas = sqliteTable("tx_gas", {
  txHash: text("tx_hash").primaryKey(),
  blockNumber: integer("block_number").notNull(),
  gasUsed: text("gas_used").notNull(),
  effectiveGasPrice: text("effective_gas_price").notNull(),
  feePayer: text("fee_payer").notNull(), // tx.from or paymaster — who actually bore gas
});
