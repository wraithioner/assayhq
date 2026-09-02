import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/" aria-label="Agent Scoreboard home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Agent Scoreboard</span>
        </Link>
        <div className="header-meta">
          <span className="independent-label">Independent</span>
          <span className="chain-chip">
            <span className="status-dot" aria-hidden="true" />
            Robinhood Chain · 4663
          </span>
        </div>
      </div>
    </header>
  );
}
