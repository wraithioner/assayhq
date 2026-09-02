import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Leaderboard } from "@/components/Leaderboard";
import { PerformanceChart } from "@/components/PerformanceChart";
import type { NavPoint } from "@rhchain/metrics";

const point = (timestamp: number, net: number, benchmark: number): NavPoint => ({
  blockNumber: timestamp,
  timestamp,
  wallet: "0x0000000000000000000000000000000000000001",
  segmentStart: false,
  portfolioNavUsd8: "10000000000",
  stockExposureUsd8: "5000000000",
  externalFlowUsd8: "0",
  gasCostUsd8: "0",
  slippageCostUsd8: "0",
  netPeriodReturn: null,
  grossPeriodReturn: null,
  benchmarkPeriodReturn: null,
  netWealthIndex: net,
  grossWealthIndex: net,
  benchmarkWealthIndex: benchmark,
});

describe("static scoreboard components", () => {
  it("renders an explicit empty state instead of placeholder agents", () => {
    const html = renderToStaticMarkup(<Leaderboard agents={[]} />);

    expect(html).toContain("No fabricated seed data");
    expect(html).toContain("Awaiting the first indexed snapshot");
    expect(html).not.toContain("<table");
  });

  it("renders both point-in-time wealth curves when enough observations exist", () => {
    const html = renderToStaticMarkup(
      <PerformanceChart
        series={[point(1_756_684_800, 1, 1), point(1_756_771_200, 1.04, 1.01)]}
      />,
    );

    expect(html).toContain("<svg");
    expect(html).toContain("Net agent wealth index compared with the SPY total-return benchmark");
    expect(html.match(/<polyline/g)).toHaveLength(2);
  });

  it("does not imply a curve from one observation", () => {
    const html = renderToStaticMarkup(<PerformanceChart series={[point(1, 1, 1)]} />);

    expect(html).toContain("Performance curve pending");
    expect(html).not.toContain("<svg");
  });
});
