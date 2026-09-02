import rawSnapshot from "@/data/scoreboard.json";
import type { AgentScore, ScoreboardSnapshot } from "@rhchain/metrics";

export const snapshot = rawSnapshot as unknown as ScoreboardSnapshot;

export function getAgent(agentId: string): AgentScore | undefined {
  return snapshot.agents.find((agent) => agent.agentId === agentId);
}

export function hasSnapshot(): boolean {
  return snapshot.evaluationBlock > 0 && snapshot.generatedAt.length > 0;
}
