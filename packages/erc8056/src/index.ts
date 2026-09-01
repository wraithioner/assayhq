/**
 * @rhchain/erc8056 — ERC-8056 (Scaled UI Amount) adapter for Robinhood Chain.
 *
 * - raw <-> underlying-share math (floor, matching the on-chain library)
 * - a point-in-time multiplier history built from UIMultiplierUpdated events
 * - multiplier-free USD NAV (the feed is total-return, per /docs/RECON.md §3)
 * - verified event/selector/ABI constants
 */
export {
  WAD,
  TOKEN_DECIMALS,
  FEED_DECIMALS,
  SHARED_TOKEN_IMPLEMENTATION,
  TOPIC,
  SELECTOR,
  SCALED_UI_ABI,
  AGGREGATOR_V3_ABI,
  EIP_CANONICAL_TRANSFER_WITH_UI_AMOUNT_TOPIC,
} from "./constants.js";

export { toUnderlyingShares, fromUnderlyingShares, multiplierToFloat } from "./multiplier.js";

export { rawBalanceValueUsd, rawBalanceValueUsdExact, type ValueOptions } from "./value.js";

export { MultiplierHistory, type UIMultiplierUpdate } from "./history.js";
