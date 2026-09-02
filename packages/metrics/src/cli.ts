#!/usr/bin/env -S npx tsx
import { config, openReadOnlyDb } from "@rhchain/indexer";
import { MetricsEngine } from "./engine.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function optionalBlock(): number | undefined {
  const raw = arg("block");
  if (raw === undefined) return undefined;
  const block = Number(raw);
  if (!Number.isSafeInteger(block) || block < 0) throw new Error("--block must be a non-negative integer");
  return block;
}

function main(): void {
  const dbPath = arg("db");
  if (!dbPath) throw new Error("--db <index.sqlite> is required");
  const opened = openReadOnlyDb(dbPath);
  try {
    const evaluationBlock = optionalBlock();
    const engine = new MetricsEngine(
      opened.db,
      config,
      evaluationBlock === undefined ? {} : { evaluationBlock },
    );
    const agentId = arg("agent");
    const result = agentId ? engine.scoreAgent(agentId) : engine.scoreAll();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    opened.sqlite.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
