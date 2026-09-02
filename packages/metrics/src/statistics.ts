export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function sampleStdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values)!;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function annualizedRatio(
  values: readonly number[],
  elapsedSeconds: number,
): number | null {
  if (values.length < 2 || elapsedSeconds <= 0) return null;
  const avg = mean(values)!;
  const sd = sampleStdDev(values)!;
  if (sd === 0) return null;
  const periodsPerYear = (values.length * 365.25 * 24 * 60 * 60) / elapsedSeconds;
  return (avg / sd) * Math.sqrt(periodsPerYear);
}

export function maxDrawdown(wealth: readonly number[]): number | null {
  if (wealth.length === 0) return null;
  let peak = wealth[0]!;
  let worst = 0;
  for (const value of wealth) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.max(worst, (peak - value) / peak);
  }
  return worst;
}

/** OLS slope of y against log10(x), or null when fewer than three usable fills. */
export function capacityDecaySlope(
  points: readonly { notionalUsd: number; adverseSlippageBps: number }[],
): number | null {
  const valid = points.filter(
    (point) => point.notionalUsd > 0 && Number.isFinite(point.adverseSlippageBps),
  );
  if (valid.length < 3) return null;
  const xs = valid.map((point) => Math.log10(point.notionalUsd));
  const ys = valid.map((point) => point.adverseSlippageBps);
  const xMean = mean(xs)!;
  const yMean = mean(ys)!;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < valid.length; i++) {
    numerator += (xs[i]! - xMean) * (ys[i]! - yMean);
    denominator += (xs[i]! - xMean) ** 2;
  }
  return denominator === 0 ? null : numerator / denominator;
}
