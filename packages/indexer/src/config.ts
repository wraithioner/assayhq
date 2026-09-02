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

export interface CanonicalStockToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  isin: string;
}

export interface QuoteAsset {
  address: `0x${string}`;
  decimals: number;
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
  quoteAssets: { USDG: QuoteAsset; WETH: QuoteAsset };
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
  canonicalStockTokens: CanonicalStockToken[];
  scoreableTokens: ScoreableToken[];
}

type ConfigFile = Omit<IndexerConfig, "canonicalStockTokens">;

function loadCanonicalStockTokens(path: string): CanonicalStockToken[] {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header?.startsWith("symbol,address,chainId,decimals,")) {
    throw new Error(`unexpected Stock Token CSV header in ${path}`);
  }
  return lines.map((line) => {
    const [symbol, address, chainId, decimals, , , status, isin] = line.split(",");
    if (!symbol || !address || !decimals || !isin) throw new Error(`bad Stock Token row: ${line}`);
    if (chainId !== "4663" || status !== "ASSET_STATUS_ACTIVE") {
      throw new Error(`unexpected Stock Token deployment: ${line}`);
    }
    return { symbol, address: address as `0x${string}`, decimals: Number(decimals), isin };
  });
}

export function loadConfig(path?: string, tokenCsvPath?: string): IndexerConfig {
  const p = path ?? join(here, "..", "config", "robinhood-mainnet.json");
  const stockTokens =
    tokenCsvPath ?? join(here, "..", "..", "..", "docs", "data", "stock-tokens.csv");
  const file = JSON.parse(readFileSync(p, "utf8")) as ConfigFile;
  return { ...file, canonicalStockTokens: loadCanonicalStockTokens(stockTokens) };
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

/** All issuer-published Stock Token addresses, including the 159 feed-less assets. */
export const canonicalStockTokenByAddress: ReadonlyMap<string, CanonicalStockToken> = new Map(
  config.canonicalStockTokens.map((t) => [t.address.toLowerCase(), t]),
);

export function isScoreable(tokenAddress: string): boolean {
  return scoreableByAddress.has(tokenAddress.toLowerCase());
}

/** The set of stablecoin/quote addresses that anchor a USD execution price. */
export const quoteAssets: ReadonlySet<string> = new Set(
  Object.values(config.quoteAssets).map((a) => a.address.toLowerCase()),
);
