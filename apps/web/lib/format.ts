const USD_SCALE = 100_000_000n;

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function formatRatio(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function formatUsd8(value: string, compact = false): string {
  const raw = BigInt(value);
  const negative = raw < 0n;
  const magnitude = negative ? -raw : raw;
  if (compact) {
    const dollars = Number(magnitude) / Number(USD_SCALE);
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(dollars);
    return negative ? `-${formatted}` : formatted;
  }
  const roundedCents = (magnitude + 500_000n) / 1_000_000n;
  const whole = roundedCents / 100n;
  const cents = (roundedCents % 100n).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${cents}`;
}

export function shortAddress(address: string | null): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not bound";
}

export function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    "no-verified-wallet-binding": "No verified agent wallet",
    "unattributed-stock-flow": "Unattributed stock flow",
    "ambiguous-stock-flow": "Ambiguous swap attribution",
    "overlapping-wallet-binding": "Wallet claimed by multiple agents",
    "missing-gas-receipt": "Missing gas receipt",
    "missing-gas-price": "Missing ETH/USD price",
    "missing-trade-price": "Missing execution price",
    "missing-nav-price": "Missing NAV price",
    "incomplete-transfer-history": "Incomplete transfer history",
    "insufficient-return-history": "Insufficient return history",
    "stock-leg-amount-mismatch": "Stock leg does not match swap",
    "cash-leg-amount-mismatch": "Cash leg does not match swap",
    "swap-direction-mismatch": "Swap direction mismatch",
    "coverage:no-flow": "No attributable trading flow",
    "coverage:majority-feedless": "Majority feed-less flow",
    "coverage:unknown-unpriced-flow": "Unpriced flow in coverage",
  };
  return labels[reason] ?? reason.replaceAll("-", " ");
}
