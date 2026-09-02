import { describe, expect, it } from "vitest";
import { formatPercent, formatUsd8, shortAddress } from "../lib/format.js";

describe("scoreboard formatting", () => {
  it("formats fixed-point USD without floating-point cents", () => {
    expect(formatUsd8("123456789012")).toBe("$1,234.57");
    expect(formatUsd8("-10500000")).toBe("-$0.11");
  });

  it("formats ratios and addresses defensively", () => {
    expect(formatPercent(0.1234)).toBe("+12.3%");
    expect(formatPercent(null)).toBe("—");
    expect(shortAddress("0x1234567890abcdef")).toBe("0x1234…cdef");
    expect(shortAddress(null)).toBe("Not bound");
  });
});
