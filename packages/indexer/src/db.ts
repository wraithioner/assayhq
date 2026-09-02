/**
 * SQLite connection + schema DDL. The DDL mirrors src/schema.ts (Drizzle table
 * defs are used for typed queries; this hand-written DDL keeps the file a
 * single, transparent artifact a third party can inspect and recreate).
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenedDb {
  sqlite: Database.Database;
  db: Db;
}

export function openDb(path = ":memory:"): OpenedDb {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  createSchema(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

/** Open an existing index database without schema creation or any other write. */
export function openReadOnlyDb(path: string): OpenedDb {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export function createSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS indexer_state (
      id TEXT PRIMARY KEY,
      last_block INTEGER NOT NULL DEFAULT 0,
      last_block_hash TEXT,
      finalized_block INTEGER NOT NULL DEFAULT 0,
      start_block INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS blocks (
      number INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      parent_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      address TEXT PRIMARY KEY,
      symbol TEXT,
      decimals INTEGER NOT NULL DEFAULT 18,
      feed_proxy TEXT,
      feed_decimals INTEGER,
      scoreable INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      agent_wallet TEXT,
      agent_uri TEXT,
      registered_block INTEGER NOT NULL,
      registered_at INTEGER NOT NULL,
      registered_tx TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_owner_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      block_timestamp INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      UNIQUE (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS aoh_agent_idx ON agent_owner_history (agent_id, block_number);

    CREATE TABLE IF NOT EXISTS agent_wallet_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      block_timestamp INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      UNIQUE (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS awh_agent_idx ON agent_wallet_history (agent_id, block_number, log_index);
    CREATE INDEX IF NOT EXISTS awh_wallet_idx ON agent_wallet_history (wallet, block_number);

    CREATE TABLE IF NOT EXISTS token_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      ui_value TEXT NOT NULL,
      scoreable INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      block_timestamp INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      attributed_swap_id INTEGER,
      attribution_status TEXT NOT NULL DEFAULT 'pending',
      attribution_method TEXT,
      UNIQUE (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS tt_from_idx ON token_transfers (from_addr, block_number);
    CREATE INDEX IF NOT EXISTS tt_to_idx ON token_transfers (to_addr, block_number);
    CREATE INDEX IF NOT EXISTS tt_tx_idx ON token_transfers (tx_hash);

    CREATE TABLE IF NOT EXISTS cash_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      value TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      block_timestamp INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      UNIQUE (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS ct_from_idx ON cash_transfers (from_addr, block_number);
    CREATE INDEX IF NOT EXISTS ct_to_idx ON cash_transfers (to_addr, block_number);
    CREATE INDEX IF NOT EXISTS ct_tx_idx ON cash_transfers (tx_hash);

    CREATE TABLE IF NOT EXISTS uni_pools (
      address TEXT PRIMARY KEY,
      token0 TEXT NOT NULL,
      token1 TEXT NOT NULL,
      fee INTEGER NOT NULL,
      stock_token TEXT NOT NULL,
      quote_token TEXT NOT NULL,
      created_block INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool TEXT NOT NULL,
      stock_token TEXT NOT NULL,
      quote_token TEXT NOT NULL,
      stock_amount TEXT NOT NULL,
      quote_amount TEXT NOT NULL,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      block_timestamp INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      UNIQUE (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS swap_tx_idx ON swaps (tx_hash);

    CREATE TABLE IF NOT EXISTS multiplier_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      old_multiplier TEXT NOT NULL,
      new_multiplier TEXT NOT NULL,
      effective_at INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      UNIQUE (tx_hash, log_index)
    );

    CREATE TABLE IF NOT EXISTS price_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_proxy TEXT NOT NULL,
      aggregator TEXT NOT NULL,
      answer TEXT NOT NULL,
      round_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      UNIQUE (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS pu_feed_time_idx ON price_updates (feed_proxy, updated_at);

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_proxy TEXT NOT NULL,
      answer TEXT NOT NULL,
      round_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      block_timestamp INTEGER NOT NULL,
      source TEXT NOT NULL,
      UNIQUE (feed_proxy, block_number)
    );
    CREATE INDEX IF NOT EXISTS ps_feed_block_idx ON price_snapshots (feed_proxy, block_number);

    CREATE TABLE IF NOT EXISTS tx_gas (
      tx_hash TEXT PRIMARY KEY,
      block_number INTEGER NOT NULL,
      gas_used TEXT NOT NULL,
      effective_gas_price TEXT NOT NULL,
      tx_from TEXT NOT NULL
    );
  `);
}
