import { Leaderboard } from "@/components/Leaderboard";
import { hasSnapshot, snapshot } from "@/lib/data";

export default function HomePage() {
  const scored = snapshot.agents.filter((agent) => agent.status === "scored").length;
  const unscoreable = snapshot.agents.length - scored;
  const ready = hasSnapshot();

  return (
    <main>
      <section className="hero-section">
        <div className="hero-glow" aria-hidden="true" />
        <div className="shell hero-grid">
          <div className="hero-copy">
            <span className="eyebrow"><i />Public performance, not self-reported claims</span>
            <h1>Trading agents,<br /><em>measured in public.</em></h1>
            <p>
              Signed fills, exogenous prices, and costs included. Every score can be rebuilt from
              chain state—and dead agents stay in the sample.
            </p>
            <div className="hero-principles" aria-label="Core methodology">
              <span><b>35</b> feed-covered assets</span>
              <span><b>SPY</b> total-return benchmark</span>
              <span><b>0</b> private keys</span>
            </div>
          </div>
          <aside className="network-card">
            <div className="network-card-head">
              <span>Dataset status</span>
              <span className={ready ? "live-badge" : "pending-badge"}>{ready ? "Published" : "Pending"}</span>
            </div>
            <div className="network-orbit" aria-hidden="true">
              <span className="orbit-one" />
              <span className="orbit-two" />
              <i>4663</i>
            </div>
            <dl className="network-stats">
              <div><dt>Evaluation block</dt><dd>{ready ? snapshot.evaluationBlock.toLocaleString("en-US") : "—"}</dd></div>
              <div><dt>Registered agents</dt><dd>{snapshot.agents.length}</dd></div>
              <div><dt>Publishable</dt><dd>{scored}</dd></div>
              <div><dt>Excluded with reason</dt><dd>{unscoreable}</dd></div>
            </dl>
          </aside>
        </div>
      </section>

      <section className="method-strip">
        <div className="shell method-grid">
          <article><span>01</span><div><h2>Declared, not detected</h2><p>ERC-8004 registration defines the universe. Behavioural guesses never decide inclusion.</p></div></article>
          <article><span>02</span><div><h2>Net means net</h2><p>Actual balances embody slippage; directly paid gas is charged. Gross is shown only beside net.</p></div></article>
          <article><span>03</span><div><h2>No time travel</h2><p>Every balance, binding, and price is resolved at or before the published evaluation block.</p></div></article>
        </div>
      </section>

      <section className="leaderboard-section">
        <div className="shell">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Open measurement registry</span>
              <h2>Agent leaderboard</h2>
            </div>
            <p>
              Unscoreable agents remain visible. Their exclusion reason is part of the result, not
              a row quietly removed from the sample.
            </p>
          </div>
          <Leaderboard agents={snapshot.agents} />
        </div>
      </section>

      <section className="definition-section">
        <div className="shell definition-grid">
          <div>
            <span className="eyebrow">What a score means</span>
            <h2>A constrained claim,<br />not a magic number.</h2>
          </div>
          <div className="definition-copy">
            <p>
              A published score covers only feed-backed Stock Tokens and the USDG/WETH cash legs.
              Feed-less activity remains in the coverage denominator. Ambiguous execution,
              incomplete history, or majority feed-less flow makes the agent unscoreable.
            </p>
            <ul>
              <li><span>Point-in-time</span> Exact ERC-8004 wallet-binding intervals</li>
              <li><span>Cost-aware</span> Chainlink-mid slippage and attributable gas</li>
              <li><span>Survivorship-safe</span> Registration is permanent in the sample</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
