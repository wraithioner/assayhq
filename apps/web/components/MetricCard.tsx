interface MetricCardProps {
  label: string;
  value: string;
  detail?: string;
  tone?: "positive" | "negative" | "neutral";
}

export function MetricCard({ label, value, detail, tone = "neutral" }: MetricCardProps) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className={`metric-value metric-${tone}`}>{value}</strong>
      {detail ? <span className="metric-detail">{detail}</span> : null}
    </div>
  );
}
