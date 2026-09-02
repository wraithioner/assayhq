export interface ChainPosition {
  blockNumber: number;
  logIndex: number;
}

export interface TimedUsdFlow extends ChainPosition {
  timestamp: number;
  usd8: bigint;
  kind: "external-cash" | "excluded-asset";
}

export interface TimedCost extends ChainPosition {
  timestamp: number;
  usd8: bigint;
  txHash: string;
}

export interface NavPoint {
  blockNumber: number;
  timestamp: number;
  wallet: string;
  segmentStart: boolean;
  portfolioNavUsd8: string;
  stockExposureUsd8: string;
  externalFlowUsd8: string;
  gasCostUsd8: string;
  slippageCostUsd8: string;
  netPeriodReturn: number | null;
  grossPeriodReturn: number | null;
  benchmarkPeriodReturn: number | null;
  netWealthIndex: number;
  grossWealthIndex: number;
  benchmarkWealthIndex: number;
}

export type ScoreStatus = "scored" | "unscoreable";

export interface AgentScore {
  schemaVersion: 1;
  chainId: number;
  evaluationBlock: number;
  evaluationTimestamp: number;
  agentId: string;
  ownerAtEvaluation: string;
  agentWalletAtEvaluation: string | null;
  agentURI: string | null;
  registeredBlock: number;
  registeredAt: number;
  status: ScoreStatus;
  reasons: string[];
  benchmark: { symbol: string; source: "inferred" };
  scope: {
    scoreableTokenCount: number;
    canonicalTokenCount: number;
    coverageRatio: number;
    scoredFlowUsd8: string;
    totalFlowUsd8: string;
    unattributedTransfers: number;
    ambiguousTransfers: number;
    overlappingWalletBinding: boolean;
    entrySelectionBias: true;
    nativeAssetNavExcluded: true;
    gasAttribution: "direct-tx-sender-only";
  };
  metrics: {
    portfolioNavUsd8: string;
    netReturn: number | null;
    grossReturn: number | null;
    benchmarkReturn: number | null;
    alpha: number | null;
    sharpe: number | null;
    informationRatio: number | null;
    maxDrawdown: number | null;
    turnover: number | null;
    capacityDecayBpsPerLog10Usd: number | null;
    timeInMarket: number | null;
    gasCostUsd8: string;
    unassignedGasUsd8: string;
    slippageCostUsd8: string;
    scoredTradeCount: number;
  };
  series: NavPoint[];
  recomputeCommand: string;
}

export interface ScoreboardSnapshot {
  schemaVersion: 1;
  chainId: number;
  evaluationBlock: number;
  generatedAt: string;
  agents: AgentScore[];
}
