/**
 * Verified ERC-8056 constants for Robinhood Chain stock tokens.
 *
 * Every value here was verified on-chain (2026-09-01) against the shared token
 * implementation and live logs — see /docs/RECON.md §4. Topic hashes were
 * recomputed with a self-tested keccak256 (/scripts/recon/keccak.py); the
 * self-test matches the canonical ERC-20 Transfer topic.
 *
 * IMPORTANT: the deployed transfer event is `TransferWithScaledUI`, NOT the
 * EIP-8056 (Draft) canonical `TransferWithUIAmount`. Index by the topic below.
 */

/** 18-decimal fixed point: 1e18 represents a multiplier of 1.0. */
export const WAD = 1_000_000_000_000_000_000n;

/** Stock tokens are standard ERC-20 with 18 decimals (verified on-chain). */
export const TOKEN_DECIMALS = 18;

/** Chainlink total-return feeds report 8 decimals (verified on-chain). */
export const FEED_DECIMALS = 8;

/** Shared beacon implementation behind every stock-token BeaconProxy. */
export const SHARED_TOKEN_IMPLEMENTATION =
  "0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2" as const;

/** Event topic0 hashes (keccak256 of the canonical signature). */
export const TOPIC = {
  /** Transfer(address,address,uint256) */
  Transfer:
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  /** TransferWithScaledUI(address,address,uint256,uint256) — the deployed name. */
  TransferWithScaledUI:
    "0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802",
  /** UIMultiplierUpdated(uint256,uint256,uint256) */
  UIMultiplierUpdated:
    "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055",
} as const;

/**
 * The EIP-8056 (Draft) canonical transfer event name. It is NOT emitted on
 * Robinhood Chain; kept only so an indexer can assert its absence and catch a
 * future contract upgrade that switches to the canonical name.
 */
export const EIP_CANONICAL_TRANSFER_WITH_UI_AMOUNT_TOPIC =
  "0x0226a2f5c1ae0e071aeec3d4ebafcefdc5c549be11f40ed27e76e802acccf374";

/** 4-byte function selectors (keccak256 of the signature, first 4 bytes). */
export const SELECTOR = {
  uiMultiplier: "0xa60bf13d", // uiMultiplier()
  newUIMultiplier: "0xdc767007", // newUIMultiplier()
  effectiveAt: "0x97a4064f", // effectiveAt()
  balanceOfUI: "0x437a9958", // balanceOfUI(address)
  totalSupplyUI: "0x9bea6429", // totalSupplyUI()
  balanceOf: "0x70a08231", // balanceOf(address)
  totalSupply: "0x18160ddd", // totalSupply()
  decimals: "0x313ce567", // decimals()
} as const;

/**
 * Human-readable ABI fragments for the ERC-8056 surface actually deployed on
 * Robinhood Chain. Consumable by viem's `parseAbi`.
 */
export const SCALED_UI_ABI = [
  // --- ERC-8056 core ---
  "function uiMultiplier() view returns (uint256)",
  "function balanceOfUI(address account) view returns (uint256)",
  "function totalSupplyUI() view returns (uint256)",
  // --- scheduled/pending change ---
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  // --- events ---
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue)",
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)",
] as const;

/** Chainlink AggregatorV3Interface fragment (feeds are standard V3). */
export const AGGREGATOR_V3_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
] as const;
