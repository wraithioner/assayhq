/**
 * Indexer configuration for Robinhood Chain.
 *
 * Addresses come from /docs/RECON.md (primary-source verified) via
 * config/robinhood-mainnet.json. The scoreable universe is the 35 stock tokens
 * that have a Chainlink total-return feed; everything else is treated as
 * feed-less (see the go-ahead constraints in /docs/DECISIONS.md).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineChain } from "viem";

const here = dirname(fileURLToPath(import.meta.url));

export interface ScoreableToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  isin: string;
  feedProxy: `0x${string}`;
  feedSecondaryProxy: `0x${string}`;
  feedDecimals: number;
  feedHeartbeat: number;
}

export interface IndexerConfig {
  chain: {
    name: string;
    chainId: number;
    rpcUrl: string;
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  launch: { date: string; gasWaiverEndsApprox: string };
  stablecoins: { USDG: `0x${string}`; WETH: `0x${string}` };
  erc8004: {
    identityRegistry: `0x${string}`;
    identityImplementation: `0x${string}`;
    reputationRegistry: `0x${string}`;
  };
  uniswapV3: {
    factory: `0x${string}`;
    swapRouter02: `0x${string}`;
    universalRouter: `0x${string}`;
    quoterV2: `0x${string}`;
  };
  sharedTokenImplementation: `0x${string}`;
  scoreableTokens: ScoreableToken[];
}

export function loadConfig(path?: string): IndexerConfig {
  const p = path ?? join(here, "..", "config", "robinhood-mainnet.json");
  return JSON.parse(readFileSync(p, "utf8")) as IndexerConfig;
}

export const config: IndexerConfig = loadConfig();

/** viem chain definition for Robinhood Chain. */
export const robinhoodChain = defineChain({
  id: config.chain.chainId,
  name: config.chain.name,
  nativeCurrency: config.chain.nativeCurrency,
  rpcUrls: { default: { http: [config.chain.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: config.chain.explorer } },
});

/** Lower-cased address -> ScoreableToken, for O(1) classification. */
export const scoreableByAddress: ReadonlyMap<string, ScoreableToken> = new Map(
  config.scoreableTokens.map((t) => [t.address.toLowerCase(), t]),
);

export function isScoreable(tokenAddress: string): boolean {
  return scoreableByAddress.has(tokenAddress.toLowerCase());
}

/** The set of stablecoin/quote addresses that anchor a USD execution price. */
export const quoteAssets: ReadonlySet<string> = new Set(
  [config.stablecoins.USDG, config.stablecoins.WETH].map((a) => a.toLowerCase()),
);
