import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, openReadOnlyDb } from "../src/db.js";
import * as t from "../src/schema.js";

describe("read-only database access", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("allows recomputation reads but rejects writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "rh-indexer-"));
    dirs.push(dir);
    const path = join(dir, "index.sqlite");
    const writer = openDb(path);
    writer.db
      .insert(t.indexerState)
      .values({ id: "main", lastBlock: 1, finalizedBlock: 1, startBlock: 1, updatedAt: 1 })
      .run();
    writer.sqlite.close();

    const reader = openReadOnlyDb(path);
    expect(reader.db.select().from(t.indexerState).all()).toHaveLength(1);
    expect(() =>
      reader.db
        .insert(t.indexerState)
        .values({ id: "other", lastBlock: 1, finalizedBlock: 1, startBlock: 1, updatedAt: 1 })
        .run(),
    ).toThrow(/readonly/i);
    reader.sqlite.close();
  });
});
