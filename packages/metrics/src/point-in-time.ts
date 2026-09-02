import type { ChainPosition } from "./types.js";

export interface BlockPoint {
  blockNumber: number;
}

export function comparePosition(a: ChainPosition, b: ChainPosition): number {
  return a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
}

export function atOrBefore(a: ChainPosition, b: ChainPosition): boolean {
  return comparePosition(a, b) <= 0;
}

/** Last block-valued row at-or-before the requested block; never looks ahead. */
export function asOfBlock<T extends BlockPoint>(rowsAsc: readonly T[], blockNumber: number): T | null {
  let lo = 0;
  let hi = rowsAsc.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rowsAsc[mid]!.blockNumber <= blockNumber) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? null : rowsAsc[found]!;
}

export interface WalletBindingPoint extends ChainPosition {
  wallet: string | null;
}

/** Last wallet binding at-or-before an exact block/log position. */
export function walletAsOf(
  rowsAsc: readonly WalletBindingPoint[],
  position: ChainPosition,
): string | null {
  let wallet: string | null = null;
  for (const row of rowsAsc) {
    if (!atOrBefore(row, position)) break;
    wallet = row.wallet;
  }
  return wallet;
}
