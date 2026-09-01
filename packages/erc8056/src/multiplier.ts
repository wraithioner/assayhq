/**
 * ERC-8056 raw <-> underlying-share conversion.
 *
 * The token never rebases: `balanceOf`/`totalSupply` (the "raw" amount) are
 * fixed. The number of underlying shares a raw amount represents is scaled by
 * the UI multiplier (18-decimal fixed point):
 *
 *     underlying shares = raw amount * uiMultiplier / 1e18        (verbatim, docs)
 *
 * Both directions floor, matching Solidity `mulDiv` truncation (see
 * solidity/ScaledUIMath.sol). Round-tripping therefore loses at most a tiny,
 * bounded number of wei (see test/multiplier.test.ts).
 */
import { WAD } from "./constants.js";

function assertNonNegative(x: bigint, name: string): void {
  if (x < 0n) throw new RangeError(`${name} must be non-negative, got ${x}`);
}

function assertPositiveMultiplier(m: bigint): void {
  if (m <= 0n) throw new RangeError(`uiMultiplier must be > 0, got ${m}`);
}

/**
 * Convert a raw token amount to underlying shares at a given multiplier.
 * Floors, exactly like the on-chain library.
 */
export function toUnderlyingShares(rawAmount: bigint, uiMultiplier: bigint): bigint {
  assertNonNegative(rawAmount, "rawAmount");
  assertPositiveMultiplier(uiMultiplier);
  return (rawAmount * uiMultiplier) / WAD;
}

/**
 * Convert underlying shares back to a raw token amount at a given multiplier.
 * Floors. This is the inverse of {@link toUnderlyingShares} up to truncation.
 */
export function fromUnderlyingShares(uiAmount: bigint, uiMultiplier: bigint): bigint {
  assertNonNegative(uiAmount, "uiAmount");
  assertPositiveMultiplier(uiMultiplier);
  return (uiAmount * WAD) / uiMultiplier;
}

/**
 * Human-readable multiplier as a number (e.g. 1e18 -> 1.0, 4e18 -> 4.0).
 * For display only — never use floats in accounting paths.
 */
export function multiplierToFloat(uiMultiplier: bigint): number {
  return Number(uiMultiplier) / Number(WAD);
}
