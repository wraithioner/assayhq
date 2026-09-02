/**
 * ABIs the indexer decodes. ERC-8056 fragments are re-exported from the adapter
 * package so there is one source of truth for the verified event shapes.
 */
import { parseAbi, parseAbiItem } from "viem";

/** Individual event items for viem getLogs (topic + indexed-arg filtering). */
export const evTransferWithScaledUI = parseAbiItem(
  "event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue)",
);
export const evTransfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
export const evUIMultiplierUpdated = parseAbiItem(
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)",
);
export const evRegistered = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);
export const evMetadataSet = parseAbiItem(
  "event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)",
);
export const evNftTransfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
export const evSwap = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
export const evAnswerUpdated = parseAbiItem(
  "event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)",
);

/** ERC-8056 stock-token events (TransferWithScaledUI is the deployed name). */
export const stockTokenAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue)",
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)",
]);

/** ERC-8004 IdentityRegistry (verified impl ABI subset — /docs/RECON.md §5). */
export const identityRegistryAbi = parseAbi([
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)",
  "event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);

/** Uniswap V3 factory + pool. */
export const uniswapV3FactoryAbi = parseAbi([
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

/** Standard Uniswap V3 fee tiers to probe when discovering pools by call. */
export const UNIV3_FEE_TIERS = [100, 500, 3000, 10000] as const;

export const uniswapV3PoolAbi = parseAbi([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);

/** Chainlink AggregatorV3 proxy + underlying aggregator (AnswerUpdated is on the aggregator). */
export const chainlinkFeedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function aggregator() view returns (address)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)",
]);
