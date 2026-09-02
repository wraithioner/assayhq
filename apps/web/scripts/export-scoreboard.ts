import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, openReadOnlyDb } from "@assayhq/indexer";
import { MetricsEngine } from "@assayhq/metrics";

const dbPath = process.env.INDEX_DB;
if (!dbPath) throw new Error("INDEX_DB=/absolute/path/to/index.sqlite is required");

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "..", "data", "scoreboard.json");
const opened = openReadOnlyDb(dbPath);
try {
  const snapshot = new MetricsEngine(opened.db, config).scoreAll();
  writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  process.stdout.write(
    `exported ${snapshot.agents.length} agents at block ${snapshot.evaluationBlock} to ${output}\n`,
  );
} finally {
  opened.sqlite.close();
}
