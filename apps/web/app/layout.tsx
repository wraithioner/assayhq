import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Agent Scoreboard · Robinhood Chain",
    template: "%s · Agent Scoreboard",
  },
  description:
    "Independent, point-in-time performance verification for self-declared trading agents on Robinhood Chain.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <div className="shell footer-inner">
            <p>Independent research infrastructure. Not affiliated with Robinhood Markets, Inc.</p>
            <p>No custody · No wallet connection · No investment advice</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
