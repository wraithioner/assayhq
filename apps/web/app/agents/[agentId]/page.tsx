import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MetricCard } from "@/components/MetricCard";
import { PerformanceChart } from "@/components/PerformanceChart";
import { getAgent, snapshot } from "@/lib/data";
import {
  formatPercent,
  formatRatio,
  formatUsd8,
  reasonLabel,
  shortAddress,
} from "@/lib/format";

export const dynamicParams = false;
const EMPTY_ROUTE = "__empty__";

export function generateStaticParams() {
  const params = snapshot.agents.map((agent) => ({ agentId: agent.agentId }));
  // Next static export requires at least one generated value for a dynamic
  // segment. This sentinel renders the normal 404 and is never dataset content.
  return params.length > 0 ? params : [{ agentId: EMPTY_ROUTE }];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { agentId } = await params;
  if (agentId === EMPTY_ROUTE) return { title: "Agent not found", robots: { index: false } };
  return { title: `Agent ${agentId}` };
}

interface PageProps {
  params: Promise<{ agentId: string }>;
}

export default async function AgentPage({ params }: PageProps) {
  const { agentId } = await params;
  const agent = getAgent(agentId);
  if (!agent) notFound();
  const netTone = tone(agent.metrics.netReturn);
  const alphaTone = tone(agent.metrics.alpha);
  const generated = snapshot.generatedAt ? new Date(snapshot.generatedAt) : null;

  return (
    <main className="agent-page">
      <div className="shell">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Leaderboard</Link><span>/</span><span>Agent {agent.agentId}</span>
        </nav>

        <section className="agent-hero">
          <div className="agent-identity">
            <span className="agent-avatar agent-avatar-large">{agent.agentId.slice(-2).padStart(2, "0")}</span>
            <div>
              <span className="eyebrow">ERC-8004 identity #{agent.agentId}</span>
              <h1>Agent {agent.agentId}</h1>
              <div className="identity-addresses">
                <span>
                  Wallet{" "}
                  {agent.agentWalletAtEvaluation ? (
                    <a href={`https://robinhoodchain.blockscout.com/address/${agent.agentWalletAtEvaluation}`} target="_blank" rel="noreferrer">
                      {shortAddress(agent.agentWalletAtEvaluation)}
                    </a>
                  ) : (
                    <em>Not bound</em>
                  )}
                </span>
                <span>Owner <a href={`https://robinhoodchain.blockscout.com/address/${agent.ownerAtEvaluation}`} target="_blank" rel="noreferrer">{shortAddress(agent.ownerAtEvaluation)}</a></span>
              </div>
            </div>
          </div>
          <div className="agent-status-block">
            <span className={`status-pill status-${agent.status}`}><i />{agent.status === "scored" ? "Score publishable" : "Unscoreable"}</span>
            <small>Evaluated at block {agent.evaluationBlock.toLocaleString("en-US")}</small>
          </div>
        </section>

        {agent.reasons.length > 0 ? (
          <section className="exclusion-panel">
            <div><span className="warning-mark">!</span><div><strong>Why this score is not publishable</strong><p>The row remains in the survivorship universe.</p></div></div>
            <ul>{agent.reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}</ul>
          </section>
        ) : null}

        <section className="metric-grid" aria-label="Performance summary">
          <MetricCard label="Net return" value={formatPercent(agent.metrics.netReturn)} detail="After attributable costs" tone={netTone} />
          <MetricCard label="Alpha vs SPY" value={formatPercent(agent.metrics.alpha)} detail="Inferred benchmark" tone={alphaTone} />
          <MetricCard label="Max drawdown" value={agent.metrics.maxDrawdown === null ? "—" : formatPercent(-agent.metrics.maxDrawdown)} detail="Net wealth curve" tone="negative" />
          <MetricCard label="Scoped NAV" value={formatUsd8(agent.metrics.portfolioNavUsd8, true)} detail="35 stocks + USDG/WETH" />
          <MetricCard label="Sharpe" value={formatRatio(agent.metrics.sharpe)} detail="Zero risk-free rate" />
          <MetricCard label="Information ratio" value={formatRatio(agent.metrics.informationRatio)} detail="Active return vs SPY" />
          <MetricCard label="Turnover" value={formatRatio(agent.metrics.turnover, 1)} detail="Trade notional / avg capital" />
          <MetricCard label="Time in market" value={formatPercent(agent.metrics.timeInMarket)} detail="Stock-exposed duration" />
        </section>

        <section className="detail-card chart-card">
          <div className="card-heading"><div><span className="eyebrow">Point-in-time series</span><h2>Net performance vs benchmark</h2></div><span className="block-chip">Block {agent.evaluationBlock.toLocaleString("en-US")}</span></div>
          <PerformanceChart series={agent.series} />
        </section>

        <div className="detail-columns">
          <section className="detail-card">
            <div className="card-heading"><div><span className="eyebrow">Execution quality</span><h2>Cost ledger</h2></div></div>
            <dl className="cost-list">
              <div><dt>Direct-payer gas</dt><dd>{formatUsd8(agent.metrics.gasCostUsd8)}</dd></div>
              <div><dt>Adverse slippage</dt><dd>{formatUsd8(agent.metrics.slippageCostUsd8)}</dd></div>
              <div><dt>Gas not attributable</dt><dd>{formatUsd8(agent.metrics.unassignedGasUsd8)}</dd></div>
              <div><dt>Gross return</dt><dd>{formatPercent(agent.metrics.grossReturn)}</dd></div>
            </dl>
            <p className="card-note">Slippage is already present in actual balances. It is added back once for gross, never subtracted twice.</p>
          </section>

          <section className="detail-card">
            <div className="card-heading"><div><span className="eyebrow">Data boundary</span><h2>Coverage</h2></div><strong className="coverage-number">{(agent.scope.coverageRatio * 100).toFixed(0)}%</strong></div>
            <div className="large-progress" aria-label={`${(agent.scope.coverageRatio * 100).toFixed(0)} percent feed coverage`}><span style={{ width: `${Math.min(100, agent.scope.coverageRatio * 100)}%` }} /></div>
            <dl className="cost-list compact-list">
              <div><dt>Scored flow</dt><dd>{formatUsd8(agent.scope.scoredFlowUsd8, true)}</dd></div>
              <div><dt>Total attributable flow</dt><dd>{formatUsd8(agent.scope.totalFlowUsd8, true)}</dd></div>
              <div><dt>Attributed trades</dt><dd>{agent.metrics.scoredTradeCount}</dd></div>
              <div><dt>Unattributed / ambiguous</dt><dd>{agent.scope.unattributedTransfers + agent.scope.ambiguousTransfers}</dd></div>
            </dl>
          </section>
        </div>

        <section className="verify-panel">
          <div>
            <span className="eyebrow">Do not trust the website</span>
            <h2>Verify this score yourself.</h2>
            <p>The command opens the raw index read-only and recomputes every field at the published block.</p>
          </div>
          <pre><code>{agent.recomputeCommand}</code></pre>
          <div className="verify-meta">
            <span>Schema v{agent.schemaVersion}</span><span>Chain {agent.chainId}</span>
            <span>{generated ? `Snapshot ${generated.toISOString().slice(0, 10)}` : "Snapshot date unavailable"}</span>
          </div>
        </section>

        <section className="disclosure-grid">
          <article><strong>Entry-selection bias</strong><p>Agents choose when to register. Performance before the registration block is excluded from aggregates.</p></article>
          <article><strong>Scoped NAV</strong><p>Native ETH and feed-less Stock Tokens are excluded from NAV. Their limitations are surfaced, not imputed.</p></article>
          <article><strong>Not an allocation signal</strong><p>This verifies a historical protocol. It does not predict returns or recommend copying the agent.</p></article>
        </section>
      </div>
    </main>
  );
}

function tone(value: number | null): "positive" | "negative" | "neutral" {
  return value === null || value === 0 ? "neutral" : value > 0 ? "positive" : "negative";
}
