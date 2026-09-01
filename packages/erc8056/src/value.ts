/**
 * USD valuation of a raw stock-token balance.
 *
 * KEY FACT (verified — /docs/RECON.md §3): the Chainlink feed returns the
 * *total-return* price of ONE raw token, with the corporate-action multiplier
 * ALREADY applied. So the USD value of a raw balance is:
 *
 *     usd = (rawBalance / 10^tokenDecimals) * (answer / 10^feedDecimals)
 *
 * and it does NOT depend on `uiMultiplier`. Re-applying the multiplier here is
 * the single most likely accounting bug in this system; this module exists so
 * that NAV has exactly one, multiplier-free implementation. See the property
 * test `value is independent of the multiplier` in test/value.test.ts.
 */
import { TOKEN_DECIMALS, FEED_DECIMALS } from "./constants.js";

function pow10(n: number): bigint {
  if (n < 0 || !Number.isInteger(n)) throw new RangeError(`bad exponent ${n}`);
  return 10n ** BigInt(n);
}

export interface ValueOptions {
  /** Token decimals (stock tokens are 18). */
  tokenDecimals?: number;
  /** Feed decimals (Robinhood total-return feeds are 8). */
  feedDecimals?: number;
  /** Decimals of the returned USD integer (default 18 => "USD wei"). */
  outputDecimals?: number;
}

/**
 * Value a raw balance in fixed-point USD (default 18 decimals), flooring once.
 *
 * @param rawBalance    ERC-20 raw balance (NOT underlying shares).
 * @param feedAnswer    `latestRoundData().answer` for the token's total-return feed.
 *                      Must be > 0 (callers should reject stale/zero rounds first).
 */
export function rawBalanceValueUsd(
  rawBalance: bigint,
  feedAnswer: bigint,
  opts: ValueOptions = {},
): bigint {
  if (rawBalance < 0n) throw new RangeError(`rawBalance must be >= 0, got ${rawBalance}`);
  if (feedAnswer <= 0n) throw new RangeError(`feedAnswer must be > 0, got ${feedAnswer}`);
  const tokenDecimals = opts.tokenDecimals ?? TOKEN_DECIMALS;
  const feedDecimals = opts.feedDecimals ?? FEED_DECIMALS;
  const outputDecimals = opts.outputDecimals ?? 18;
  // usd_out = rawBalance * answer * 10^out / (10^tokenDec * 10^feedDec)
  const num = rawBalance * feedAnswer * pow10(outputDecimals);
  const den = pow10(tokenDecimals + feedDecimals);
  return num / den;
}

/**
 * Exact rational value `{ num, den }` (no flooring) for recompute/audit paths
 * where intermediate precision must be preserved before a final rounding.
 */
export function rawBalanceValueUsdExact(
  rawBalance: bigint,
  feedAnswer: bigint,
  opts: Pick<ValueOptions, "tokenDecimals" | "feedDecimals"> = {},
): { num: bigint; den: bigint } {
  if (rawBalance < 0n) throw new RangeError(`rawBalance must be >= 0, got ${rawBalance}`);
  if (feedAnswer <= 0n) throw new RangeError(`feedAnswer must be > 0, got ${feedAnswer}`);
  const tokenDecimals = opts.tokenDecimals ?? TOKEN_DECIMALS;
  const feedDecimals = opts.feedDecimals ?? FEED_DECIMALS;
  return { num: rawBalance * feedAnswer, den: pow10(tokenDecimals + feedDecimals) };
}
