/** Pure ERC-8004 identity helpers. */

export const AGENT_WALLET_METADATA_KEY = "agentWallet";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface AgentWalletPoint {
  blockNumber: number;
  logIndex: number;
  wallet: string | null;
}

/**
 * ERC-8004 stores agentWallet as abi.encodePacked(address) and emits it through
 * MetadataSet. Be tolerant of a 32-byte ABI word as well, taking the final 20
 * bytes in either representation. A zero address means the binding was cleared.
 */
export function decodeAgentWalletMetadata(
  metadataKey: string,
  metadataValue: string,
): string | null | undefined {
  if (metadataKey !== AGENT_WALLET_METADATA_KEY) return undefined;
  const hex = metadataValue.startsWith("0x") ? metadataValue.slice(2) : metadataValue;
  if (hex.length < 40 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`invalid agentWallet metadata bytes: ${metadataValue}`);
  }
  const wallet = `0x${hex.slice(-40)}`.toLowerCase();
  return wallet === ZERO_ADDRESS ? null : wallet;
}

/** Last wallet binding at-or-before a block/log position. */
export function agentWalletAsOf(
  points: readonly AgentWalletPoint[],
  blockNumber: number,
  logIndex = Number.MAX_SAFE_INTEGER,
): string | null {
  let current: string | null = null;
  for (const point of points) {
    if (
      point.blockNumber > blockNumber ||
      (point.blockNumber === blockNumber && point.logIndex > logIndex)
    ) {
      break;
    }
    current = point.wallet;
  }
  return current;
}

/** Unique non-zero wallets ever cryptographically bound to an agent. */
export function walletsEverBound(points: readonly AgentWalletPoint[]): string[] {
  return [...new Set(points.flatMap((point) => (point.wallet ? [point.wallet.toLowerCase()] : [])))];
}
