/**
 * Pure pricing helpers. Point-in-time by construction: nothing here consults a
 * price update whose timestamp is after the query time.
 */

export interface PricePoint {
  updatedAt: number; // unix seconds
  answer: bigint; // feed-decimals integer (Robinhood feeds: 8)
}

/**
 * Latest feed answer at-or-before `t`. Points MUST be ascending by updatedAt.
 * Returns null when no update is at-or-before `t` (price not yet available).
 */
export function priceAsOf(pointsAsc: readonly PricePoint[], t: number): bigint | null {
  let lo = 0;
  let hi = pointsAsc.length - 1;
  let ansIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pointsAsc[mid]!.updatedAt <= t) {
      ansIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ansIdx === -1 ? null : pointsAsc[ansIdx]!.answer;
}

/** Seconds since the effective price update — for heartbeat/staleness gating. */
export function priceStaleness(pointsAsc: readonly PricePoint[], t: number): number | null {
  let lo = 0;
  let hi = pointsAsc.length - 1;
  let ansIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pointsAsc[mid]!.updatedAt <= t) {
      ansIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ansIdx === -1 ? null : t - pointsAsc[ansIdx]!.updatedAt;
}

function pow10(n: number): bigint {
  if (n < 0 || !Number.isInteger(n)) throw new RangeError(`bad exponent ${n}`);
  return 10n ** BigInt(n);
}

/**
 * Realised execution price from a Uniswap swap, in USD per ONE whole stock token,
 * scaled to `outDecimals` (default 8, to compare directly with a Chainlink
 * answer). The quote asset's own point-in-time USD feed is mandatory: this keeps
 * USDG depeg-aware and prevents WETH from being mistaken for a dollar quote.
 *
 *   price = (|quote| / 10^quoteDec) × quoteUsd
 *           / (|stock| / 10^stockDec)                           [USD per token]
 *
 * @throws if the stock amount is zero.
 */
export function execPriceUsdPerToken(args: {
  stockAmountRaw: bigint;
  quoteAmountRaw: bigint;
  stockDecimals: number;
  quoteDecimals: number;
  quoteUsdPrice: bigint;
  quotePriceDecimals: number;
  outDecimals?: number;
}): bigint {
  const stock = abs(args.stockAmountRaw);
  const quote = abs(args.quoteAmountRaw);
  if (stock === 0n) throw new RangeError("stock amount is zero; execution price undefined");
  if (args.quoteUsdPrice <= 0n) throw new RangeError("quote USD price must be > 0");
  const outDecimals = args.outDecimals ?? 8;
  const num =
    quote * args.quoteUsdPrice * pow10(args.stockDecimals) * pow10(outDecimals);
  const den =
    stock * pow10(args.quoteDecimals) * pow10(args.quotePriceDecimals);
  return num / den;
}

/**
 * Slippage of an execution vs a reference (Chainlink) mid, in basis points,
 * signed so that NEGATIVE = worse than mid for a buyer / better isn't assumed.
 * We report the unsigned magnitude and the direction separately in metrics; this
 * returns signed (exec - mid)/mid in bps.
 */
export function slippageBps(execPrice: bigint, midPrice: bigint): number {
  if (midPrice <= 0n) throw new RangeError("mid price must be > 0");
  // (exec - mid) / mid * 10000, computed in fixed point then to number
  const diff = execPrice - midPrice;
  return Number((diff * 10_000n * 1_000_000n) / midPrice) / 1_000_000;
}

/** Positive means the agent paid adverse slippage; negative means price improvement. */
export function adverseSlippageBps(
  execPrice: bigint,
  midPrice: bigint,
  side: "buy" | "sell",
): number {
  const raw = slippageBps(execPrice, midPrice);
  return side === "buy" ? raw : -raw;
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}
