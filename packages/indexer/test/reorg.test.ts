import { describe, it, expect } from "vitest";
import { findCommonAncestor, extendsTip, type StoredBlock } from "../src/reorg.js";

const B = (number: number, hash: string, parentHash: string): StoredBlock => ({
  number,
  hash,
  parentHash,
});

describe("reorg detection", () => {
  const stored: StoredBlock[] = [
    B(103, "0xd", "0xc"),
    B(102, "0xc", "0xb"),
    B(101, "0xb", "0xa"),
    B(100, "0xa", "0x9"),
  ]; // descending

  it("returns the tip when nothing reorged", () => {
    const canon = (n: number) => ({ 103: "0xd", 102: "0xc", 101: "0xb", 100: "0xa" })[n];
    expect(findCommonAncestor(stored, canon)).toBe(103);
  });

  it("finds the common ancestor when the tip changed", () => {
    // 103 and 102 got replaced; 101 still canonical
    const canon = (n: number) => ({ 103: "0xd2", 102: "0xc2", 101: "0xb", 100: "0xa" })[n];
    expect(findCommonAncestor(stored, canon)).toBe(101);
  });

  it("is hash-case-insensitive", () => {
    const canon = (n: number) => ({ 103: "0xD", 102: "0xC", 101: "0xB", 100: "0xA" })[n];
    expect(findCommonAncestor(stored, canon)).toBe(103);
  });

  it("returns -1 when the reorg is deeper than the buffer", () => {
    const canon = (_n: number) => "0xzz"; // nothing matches
    expect(findCommonAncestor(stored, canon)).toBe(-1);
  });

  it("extendsTip only when parentHash chains onto the tip", () => {
    const tip = B(103, "0xd", "0xc");
    expect(extendsTip(tip, { parentHash: "0xd" })).toBe(true);
    expect(extendsTip(tip, { parentHash: "0xdX" })).toBe(false);
    expect(extendsTip(undefined, { parentHash: "0xanything" })).toBe(true);
  });
});
