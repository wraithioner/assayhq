/**
 * @rhchain/indexer — reorg-safe, resumable indexer for Robinhood Chain.
 * Public surface for the metrics package and tooling.
 */
export {
  config,
  loadConfig,
  robinhoodChain,
  isScoreable,
  scoreableByAddress,
  canonicalStockTokenByAddress,
  quoteAssets,
} from "./config.js";
export type {
  IndexerConfig,
  ScoreableToken,
  CanonicalStockToken,
  QuoteAsset,
} from "./config.js";
export { openDb, createSchema } from "./db.js";
export type { Db, OpenedDb } from "./db.js";
export { Indexer } from "./indexer.js";
export type { IndexerOptions, SyncResult } from "./indexer.js";
export {
  attributeTransfers,
  classifyAgentCoverage,
  type TransferRef,
  type SwapRef,
  type AgentFlowItem,
  type CoverageResult,
} from "./attribution.js";
export {
  priceAsOf,
  priceStaleness,
  execPriceUsdPerToken,
  slippageBps,
  adverseSlippageBps,
  type PricePoint,
} from "./pricing.js";
export { findCommonAncestor, extendsTip, type StoredBlock } from "./reorg.js";
export {
  AGENT_WALLET_METADATA_KEY,
  ZERO_ADDRESS,
  decodeAgentWalletMetadata,
  agentWalletAsOf,
  walletsEverBound,
  type AgentWalletPoint,
} from "./identity.js";
export * as schema from "./schema.js";
