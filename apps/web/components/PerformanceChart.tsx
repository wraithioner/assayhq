import type { NavPoint } from "@rhchain/metrics";

const WIDTH = 900;
const HEIGHT = 330;
const PAD = { top: 24, right: 22, bottom: 42, left: 58 };

export function PerformanceChart({ series }: { series: NavPoint[] }) {
  if (series.length < 2) {
    return (
      <div className="chart-empty">
        <span className="chart-empty-mark" aria-hidden="true" />
        <strong>Performance curve pending</strong>
        <p>At least two priced observations are required.</p>
      </div>
    );
  }

  const values = series.flatMap((point) => [point.netWealthIndex, point.benchmarkWealthIndex]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin || Math.max(Math.abs(rawMax) * 0.05, 0.01);
  const minY = rawMin - spread * 0.12;
  const maxY = rawMax + spread * 0.12;
  const minX = Math.min(...series.map((point) => point.timestamp));
  const maxX = Math.max(...series.map((point) => point.timestamp));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (timestamp: number, index: number) =>
    PAD.left +
    (maxX === minX ? index / Math.max(1, series.length - 1) : (timestamp - minX) / (maxX - minX)) *
      plotWidth;
  const y = (value: number) => PAD.top + ((maxY - value) / (maxY - minY)) * plotHeight;
  const line = (key: "netWealthIndex" | "benchmarkWealthIndex") =>
    series.map((point, index) => `${x(point.timestamp, index)},${y(point[key])}`).join(" ");
  const ticks = Array.from({ length: 5 }, (_, index) => maxY - (spread * 1.24 * index) / 4);

  return (
    <figure className="performance-chart">
      <div className="chart-legend" aria-hidden="true">
        <span><i className="legend-agent" />Agent, net</span>
        <span><i className="legend-benchmark" />SPY total return</span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Net agent wealth index compared with the SPY total-return benchmark"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className="chart-grid"
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="chart-axis-label" x={PAD.left - 10} y={y(tick) + 4} textAnchor="end">
              {(tick * 100).toFixed(0)}
            </text>
          </g>
        ))}
        <polyline className="chart-line benchmark-line" points={line("benchmarkWealthIndex")} />
        <polyline className="chart-line agent-line" points={line("netWealthIndex")} />
        <text className="chart-axis-title" x={14} y={HEIGHT / 2} transform={`rotate(-90 14 ${HEIGHT / 2})`}>
          Wealth index · start = 100
        </text>
        <text className="chart-date" x={PAD.left} y={HEIGHT - 12}>
          {formatDate(minX)}
        </text>
        <text className="chart-date" x={WIDTH - PAD.right} y={HEIGHT - 12} textAnchor="end">
          {formatDate(maxX)}
        </text>
      </svg>
    </figure>
  );
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp * 1000));
}
