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
}

export interface SwapRef {
  id: number;
  txHash: string;
  stockToken: string; // lower-cased
  logIndex: number;
}

/**
 * Match each transfer to a swap in the same tx on the same token (nearest by
 * logIndex). Returns transfer.key -> swap.id, or -> null when unattributed.
 */
export function attributeTransfers(
  transfers: readonly TransferRef[],
  swaps: readonly SwapRef[],
): Map<string, number | null> {
  const swapsByTx = new Map<string, SwapRef[]>();
  for (const s of swaps) {
    const arr = swapsByTx.get(s.txHash) ?? [];
    arr.push(s);
    swapsByTx.set(s.txHash, arr);
  }
  const out = new Map<string, number | null>();
  for (const t of transfers) {
    const candidates = (swapsByTx.get(t.txHash) ?? []).filter(
      (s) => s.stockToken.toLowerCase() === t.token.toLowerCase(),
    );
    if (candidates.length === 0) {
      out.set(t.key, null);
      continue;
    }
    let best = candidates[0]!;
    let bestDist = Math.abs(best.logIndex - t.logIndex);
    for (const s of candidates.slice(1)) {
      const d = Math.abs(s.logIndex - t.logIndex);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    out.set(t.key, best.id);
  }
  return out;
}

export interface AgentFlowItem {
  scoreable: boolean;
  usdVolume: bigint; // absolute USD volume of the movement (>= 0)
}

export interface CoverageResult {
  /** Scoreable iff there is scoreable flow AND it is the majority by USD volume. */
  scoreable: boolean;
  /** scoredUsd / totalUsd in [0,1]; 0 when there is no flow. */
  coverageRatio: number;
  scoredUsd: bigint;
  totalUsd: bigint;
  reason: "ok" | "no-flow" | "majority-feedless";
}

/**
 * Decide whether an agent is scoreable from the feed coverage of its flow.
 * Rule (from the go-ahead): majority feed-less => unscoreable; never partial.
 */
export function classifyAgentCoverage(items: readonly AgentFlowItem[]): CoverageResult {
  let scoredUsd = 0n;
  let totalUsd = 0n;
  for (const it of items) {
    const v = it.usdVolume < 0n ? -it.usdVolume : it.usdVolume;
    totalUsd += v;
    if (it.scoreable) scoredUsd += v;
  }
  if (totalUsd === 0n) {
    return { scoreable: false, coverageRatio: 0, scoredUsd, totalUsd, reason: "no-flow" };
  }
  const coverageRatio = Number((scoredUsd * 1_000_000n) / totalUsd) / 1_000_000;
  // majority NOT feed-less: scoredUsd >= totalUsd/2  <=>  2*scoredUsd >= totalUsd
  const scoreable = scoredUsd * 2n >= totalUsd && scoredUsd > 0n;
  return {
    scoreable,
    coverageRatio,
    scoredUsd,
    totalUsd,
    reason: scoreable ? "ok" : "majority-feedless",
  };
}
