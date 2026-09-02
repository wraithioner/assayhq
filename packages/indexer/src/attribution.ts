/**
 * Pure attribution + coverage logic.
 *
 * Attribution (v1, Uniswap-only): a stock-token balance change that touches an
 * agent is "attributed" iff its transaction also contains a Uniswap swap on the
 * SAME token — then we know the execution price. Everything else is
 * "unattributed flow" (another venue such as Rialto/Lighter, an OTC transfer, or
 * a plain wallet move). Unattributed flow is excluded from execution scoring and,
 * aggregated by token, tells us which venue to integrate next.
 */

export interface TransferRef {
  /** stable key, e.g. `${txHash}:${logIndex}` */
  key: string;
  txHash: string;
  token: string; // lower-cased
  logIndex: number;
  fromAddr: string;
  toAddr: string;
  rawValue: bigint;
}

export interface SwapRef {
  id: number;
  txHash: string;
  stockToken: string; // lower-cased
  logIndex: number;
  pool: string;
  stockAmount: bigint;
}

export type AttributionMethod = "pool-counterparty" | "exact-amount" | "single-candidate";

export interface AttributionResult {
  swapId: number | null;
  status: "matched" | "unattributed" | "ambiguous";
  method: AttributionMethod | null;
}

/**
 * Match each transfer to a swap in the same tx on the same token (nearest by
 * logIndex). Returns transfer.key -> swap.id, or -> null when unattributed.
 */
export function attributeTransfers(
  transfers: readonly TransferRef[],
  swaps: readonly SwapRef[],
): Map<string, AttributionResult> {
  const swapsByTx = new Map<string, SwapRef[]>();
  for (const s of swaps) {
    const arr = swapsByTx.get(s.txHash) ?? [];
    arr.push(s);
    swapsByTx.set(s.txHash, arr);
  }
  const out = new Map<string, AttributionResult>();
  for (const t of transfers) {
    const candidates = (swapsByTx.get(t.txHash) ?? []).filter(
      (s) => s.stockToken.toLowerCase() === t.token.toLowerCase(),
    );
    if (candidates.length === 0) {
      out.set(t.key, { swapId: null, status: "unattributed", method: null });
      continue;
    }

    const poolMatches = candidates.filter(
      (s) =>
        (t.fromAddr.toLowerCase() === s.pool.toLowerCase() ||
          t.toAddr.toLowerCase() === s.pool.toLowerCase()) &&
        abs(s.stockAmount) === t.rawValue,
    );
    if (poolMatches.length === 1) {
      out.set(t.key, {
        swapId: poolMatches[0]!.id,
        status: "matched",
        method: "pool-counterparty",
      });
      continue;
    }

    const amountMatches = candidates.filter((s) => abs(s.stockAmount) === t.rawValue);
    if (amountMatches.length === 1) {
      out.set(t.key, {
        swapId: amountMatches[0]!.id,
        status: "matched",
        method: "exact-amount",
      });
      continue;
    }

    if (candidates.length === 1) {
      out.set(t.key, {
        swapId: candidates[0]!.id,
        status: "matched",
        method: "single-candidate",
      });
      continue;
    }

    // Multiple same-token swaps without a unique amount/pool match are not
    // guessed. A false match is worse than an explicitly incomplete score.
    out.set(t.key, { swapId: null, status: "ambiguous", method: null });
  }
  return out;
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export interface AgentFlowItem {
  scoreable: boolean;
  /** null when a feed-less/unattributed movement has no defensible USD price. */
  usdVolume: bigint | null;
}

export interface CoverageResult {
  /** Scoreable iff there is scoreable flow AND it is the majority by USD volume. */
  scoreable: boolean;
  /** scoredUsd / totalUsd in [0,1]; 0 when there is no flow. */
  coverageRatio: number;
  scoredUsd: bigint;
  totalUsd: bigint;
  unknownItems: number;
  reason: "ok" | "no-flow" | "majority-feedless" | "unknown-unpriced-flow";
}

/**
 * Decide whether an agent is scoreable from the feed coverage of its flow.
 * Rule (from the go-ahead): majority feed-less => unscoreable; never partial.
 */
export function classifyAgentCoverage(items: readonly AgentFlowItem[]): CoverageResult {
  let scoredUsd = 0n;
  let totalUsd = 0n;
  let unknownItems = 0;
  for (const it of items) {
    if (it.usdVolume === null) {
      unknownItems++;
      continue;
    }
    const v = it.usdVolume < 0n ? -it.usdVolume : it.usdVolume;
    totalUsd += v;
    if (it.scoreable) scoredUsd += v;
  }
  if (totalUsd === 0n) {
    return {
      scoreable: false,
      coverageRatio: 0,
      scoredUsd,
      totalUsd,
      unknownItems,
      reason: unknownItems > 0 ? "unknown-unpriced-flow" : "no-flow",
    };
  }
  const coverageRatio = Number((scoredUsd * 1_000_000n) / totalUsd) / 1_000_000;
  // majority NOT feed-less: scoredUsd >= totalUsd/2  <=>  2*scoredUsd >= totalUsd
  const scoreable = unknownItems === 0 && scoredUsd * 2n >= totalUsd && scoredUsd > 0n;
  return {
    scoreable,
    coverageRatio,
    scoredUsd,
    totalUsd,
    unknownItems,
    reason: unknownItems > 0 ? "unknown-unpriced-flow" : scoreable ? "ok" : "majority-feedless",
  };
}
