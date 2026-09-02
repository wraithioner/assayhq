import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found shell">
      <span className="eyebrow">404 · Outside the registry</span>
      <h1>Agent not found.</h1>
      <p>This identity is not present in the exported ERC-8004 survivorship universe.</p>
      <Link className="text-link" href="/">Return to leaderboard →</Link>
    </main>
  );
}
