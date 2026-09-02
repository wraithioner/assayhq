import { describe, expect, it } from "vitest";
import {
  agentWalletAsOf,
  decodeAgentWalletMetadata,
  walletsEverBound,
} from "../src/identity.js";

describe("ERC-8004 agentWallet history", () => {
  const walletA = "0x1111111111111111111111111111111111111111";
  const walletB = "0x2222222222222222222222222222222222222222";

  it("decodes packed and ABI-word address metadata", () => {
    expect(decodeAgentWalletMetadata("agentWallet", walletA)).toBe(walletA);
    expect(decodeAgentWalletMetadata("agentWallet", `0x${"0".repeat(24)}${walletB.slice(2)}`)).toBe(
      walletB,
    );
    expect(decodeAgentWalletMetadata("other", walletA)).toBeUndefined();
  });

  it("treats the zero address as a cleared binding", () => {
    expect(
      decodeAgentWalletMetadata("agentWallet", "0x0000000000000000000000000000000000000000"),
    ).toBeNull();
  });

  it("resolves the binding point-in-time, including same-block ordering", () => {
    const points = [
      { blockNumber: 10, logIndex: 2, wallet: walletA },
      { blockNumber: 20, logIndex: 3, wallet: null },
      { blockNumber: 20, logIndex: 8, wallet: walletB },
    ];
    expect(agentWalletAsOf(points, 9)).toBeNull();
    expect(agentWalletAsOf(points, 10)).toBe(walletA);
    expect(agentWalletAsOf(points, 20, 5)).toBeNull();
    expect(agentWalletAsOf(points, 20, 8)).toBe(walletB);
    expect(walletsEverBound(points)).toEqual([walletA, walletB]);
  });
});
