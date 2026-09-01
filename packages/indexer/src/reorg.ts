/**
 * Pure reorg logic. The indexer keeps a buffer of recent block headers; on each
 * step it re-checks that our stored hashes still match the canonical chain and,
 * if not, rolls back all event rows above the common ancestor before re-indexing.
 */
export interface StoredBlock {
  number: number;
  hash: string;
  parentHash: string;
}

/**
 * Highest block number at which our stored hash still equals the canonical hash.
 *
 * @param storedDesc  recent stored blocks, DESCENDING by number (tip first).
 * @param canonicalHash  fresh canonical hash at a height, or undefined if unknown.
 * @returns the common-ancestor block number; -1 if even the oldest buffered block
 *          diverges (a reorg deeper than the buffer — caller must resync from a
 *          finalized checkpoint).
 */
export function findCommonAncestor(
  storedDesc: readonly StoredBlock[],
  canonicalHash: (n: number) => string | undefined,
): number {
  for (const b of storedDesc) {
    const canon = canonicalHash(b.number);
    if (canon !== undefined && eqHash(canon, b.hash)) return b.number;
  }
  return -1;
}

/**
 * True if `header` extends our stored tip (its parentHash matches the tip's hash).
 * A false result on a contiguous fetch signals a reorg at/below the tip.
 */
export function extendsTip(tip: StoredBlock | undefined, header: { parentHash: string }): boolean {
  if (!tip) return true; // nothing stored yet
  return eqHash(tip.hash, header.parentHash);
}

function eqHash(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
