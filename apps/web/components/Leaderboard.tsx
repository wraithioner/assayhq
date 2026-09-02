"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AgentScore } from "@rhchain/metrics";
import { formatPercent, formatUsd8, shortAddress } from "@/lib/format";

type SortKey = "netReturn" | "alpha" | "maxDrawdown" | "coverage" | "nav";
type Direction = "asc" | "desc";

const columns: Array<{ key: SortKey; label: string }> = [
  { key: "netReturn", label: "Net return" },
  { key: "alpha", label: "Alpha vs SPY" },
  { key: "maxDrawdown", label: "Max drawdown" },
  { key: "coverage", label: "Coverage" },
  { key: "nav", label: "Scoped NAV" },
];

export function Leaderboard({ agents }: { agents: AgentScore[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("netReturn");
  const [direction, setDirection] = useState<Direction>("desc");
  const sorted = useMemo(() => {
    return [...agents].sort((a, b) => {
      if (a.status !== b.status) return a.status === "scored" ? -1 : 1;
      const aValue = sortValue(a, sortKey);
      const bValue = sortValue(b, sortKey);
      const result = aValue === bValue ? a.agentId.localeCompare(b.agentId) : aValue - bValue;
      return direction === "asc" ? result : -result;
    });
  }, [agents, direction, sortKey]);

  const chooseSort = (key: SortKey) => {
    if (sortKey === key) setDirection((current) => (current === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setDirection(key === "maxDrawdown" ? "asc" : "desc");
    }
  };

  if (agents.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-orbit" aria-hidden="true"><span /></div>
        <div>
          <span className="eyebrow">No fabricated seed data</span>
          <h3>Awaiting the first indexed snapshot</h3>
          <p>
            Export a fully priced metrics snapshot to populate this board. Until then, the honest
            leaderboard is empty.
          </p>
          <code>INDEX_DB=/path/index.sqlite pnpm --filter @rhchain/web export:data</code>
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th className="rank-column">#</th>
            <th>Agent</th>
            <th>Status</th>
            {columns.map((column) => (
              <th key={column.key} aria-sort={sortKey === column.key ? (direction === "desc" ? "descending" : "ascending") : "none"}>
                <button className="sort-button" onClick={() => chooseSort(column.key)} type="button">
                  {column.label}
                  <span className={sortKey === column.key ? "sort-active" : "sort-idle"} aria-hidden="true">
                    {sortKey === column.key && direction === "asc" ? "↑" : "↓"}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent, index) => (
            <tr key={agent.agentId}>
              <td className="rank-cell">{String(index + 1).padStart(2, "0")}</td>
              <td>
                <Link className="agent-link" href={`/agents/${agent.agentId}`}>
                  <span className="agent-avatar">{agent.agentId.slice(-2).padStart(2, "0")}</span>
                  <span>
                    <strong>Agent {agent.agentId}</strong>
                    <small>{shortAddress(agent.agentWalletAtEvaluation)}</small>
                  </span>
                </Link>
              </td>
              <td>
                <span className={`status-pill status-${agent.status}`}>
                  <i aria-hidden="true" />{agent.status === "scored" ? "Scored" : "Unscoreable"}
                </span>
              </td>
              <MetricCell value={agent.metrics.netReturn} />
              <MetricCell value={agent.metrics.alpha} />
              <td>{agent.metrics.maxDrawdown === null ? "—" : formatPercent(-agent.metrics.maxDrawdown)}</td>
              <td>
                <div className="coverage-cell">
                  <span>{(agent.scope.coverageRatio * 100).toFixed(0)}%</span>
                  <i><b style={{ width: `${Math.min(100, agent.scope.coverageRatio * 100)}%` }} /></i>
                </div>
              </td>
              <td className="nav-cell">{formatUsd8(agent.metrics.portfolioNavUsd8, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCell({ value }: { value: number | null }) {
  const tone = value === null ? "muted" : value > 0 ? "positive" : value < 0 ? "negative" : "muted";
  return <td className={`value-${tone}`}>{formatPercent(value)}</td>;
}

function sortValue(agent: AgentScore, key: SortKey): number {
  switch (key) {
    case "netReturn": return agent.metrics.netReturn ?? Number.NEGATIVE_INFINITY;
    case "alpha": return agent.metrics.alpha ?? Number.NEGATIVE_INFINITY;
    case "maxDrawdown": return agent.metrics.maxDrawdown ?? Number.POSITIVE_INFINITY;
    case "coverage": return agent.scope.coverageRatio;
    case "nav": return Number(BigInt(agent.metrics.portfolioNavUsd8));
  }
}
