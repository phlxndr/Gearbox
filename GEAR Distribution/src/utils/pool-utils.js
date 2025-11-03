/**
 * Pool and events utilities
 */

// ============================================================================
// IMPORTS
// ============================================================================

import { parseAbiItem } from 'viem';
import { POOL_ABI, ERC20_TRANSFER_EVENT_ABI } from '../config.js';
import { withRetry, sleep, isBlockRangeLimitError } from './rpc-utils.js';

const DEFAULT_MAX_BLOCK_RANGE = 100000;
const MIN_BLOCK_RANGE = 2000;
const BATCH_DELAY_MS = 75;
const RETRY_OPTIONS = { maxRetries: 4, initialDelayMs: 200, backoffMultiplier: 2 };
export const SHARE_PRICE_SCALE = 1000000000000n; // scale share price by 1e12 for higher precision

// ============================================================================
// EVENT FETCHING
// ============================================================================

/**
 * Get pool events (Deposit/Withdraw) in a block range
 * @param {string} poolAddress - Pool contract address
 * @param {number} fromBlock - Starting block number
 * @param {number} toBlock - Ending block number
 * @param {Object} client - Viem client
 * @param {Function} progressCallback - Optional progress callback
 * @returns {Promise<Array>} Array of events sorted by block number
 */
export async function getPoolEvents(poolAddress, fromBlock, toBlock, client, options = {}) {
  const { progressCallback = null, includeTransfers = false } = options;
  const totalBlocks = Math.max(1, toBlock - fromBlock + 1);
  let batchSize = DEFAULT_MAX_BLOCK_RANGE;
  let currentFromBlock = fromBlock;
  let batchIndex = 0;
  let processedBlocks = 0;
  let approximateTotalBatches = Math.max(1, Math.ceil(totalBlocks / batchSize));

  console.log(`🔄 Fetching events in batches (initial size up to ${batchSize} blocks)...`);

  const allEvents = [];
  const transferEvents = includeTransfers ? [] : null;
  const depositEventAbi = parseAbiItem('event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)');
  const withdrawEventAbi = parseAbiItem('event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)');
  const transferEventAbi = includeTransfers ? parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)') : null;

  while (currentFromBlock <= toBlock) {
    const batchToBlock = Math.min(currentFromBlock + batchSize - 1, toBlock);
    try {
      const eventsToFetch = includeTransfers && transferEventAbi
        ? [depositEventAbi, withdrawEventAbi, transferEventAbi]
        : [depositEventAbi, withdrawEventAbi];

      const batchLogs = await withRetry(() => client.getLogs({
        address: poolAddress,
        events: eventsToFetch,
        fromBlock: BigInt(currentFromBlock),
        toBlock: BigInt(batchToBlock)
      }), RETRY_OPTIONS);

      let depositCount = 0;
      let withdrawCount = 0;
      let transferCount = 0;

      for (const log of batchLogs) {
        const eventName = log.eventName || '';
        if (eventName === 'Deposit') {
          depositCount += 1;
          allEvents.push({ ...log, type: 'Deposit' });
        } else if (eventName === 'Withdraw') {
          withdrawCount += 1;
          allEvents.push({ ...log, type: 'Withdraw' });
        } else if (includeTransfers && transferEvents && eventName === 'Transfer') {
          transferCount += 1;
          transferEvents.push(log);
        }
      }

      batchIndex += 1;
      processedBlocks += (batchToBlock - currentFromBlock + 1);
      const transferMsg = includeTransfers ? `, Transfer logs: ${transferCount}` : '';
      console.log(`   Batch ${batchIndex} (blocks ${currentFromBlock}-${batchToBlock}) completed. Deposit logs: ${depositCount}, Withdraw logs: ${withdrawCount}${transferMsg}, Total so far: ${allEvents.length}.`);

      if (progressCallback) {
        progressCallback({
          stage: 'fetching_events',
          progress: Math.min(processedBlocks / totalBlocks, 1),
          current: batchIndex,
          total: approximateTotalBatches,
          eventsFound: allEvents.length,
          metrics: { totalRequests: batchIndex, requestsPerSecond: 'N/A', errorRate: 0 }
        });
      }

      currentFromBlock = batchToBlock + 1;
      approximateTotalBatches = Math.max(batchIndex, batchIndex + Math.ceil(Math.max(0, toBlock - currentFromBlock + 1) / Math.max(batchSize, 1)));
      if (currentFromBlock <= toBlock) {
        await sleep(BATCH_DELAY_MS);
      }
    } catch (error) {
      if (isBlockRangeLimitError(error) && batchSize > MIN_BLOCK_RANGE) {
        batchSize = Math.max(MIN_BLOCK_RANGE, Math.floor(batchSize / 2));
        approximateTotalBatches = Math.max(batchIndex + 1, batchIndex + Math.ceil(Math.max(0, toBlock - currentFromBlock + 1) / Math.max(batchSize, 1)));
        console.warn(`⚠️ RPC limited block range, reducing batch size to ${batchSize} blocks...`);
        continue;
      }
      console.error(`Error fetching batch ${batchIndex + 1}:`, error.message);
      throw error;
    }
  }
  
  const sortedEvents = allEvents.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  console.log(`✅ Found ${sortedEvents.length} total events across ${batchIndex} batches`);
  if (includeTransfers && transferEvents) {
    transferEvents.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
    return { events: sortedEvents, transferEvents };
  }

  return { events: sortedEvents };
}

// ============================================================================
// POOL STATE DERIVATION (EVENT-BASED)
// ============================================================================

function sortEventsByBlockAndIndex(events) {
  return [...events].sort((a, b) => {
    const blockDiff = Number(a.blockNumber) - Number(b.blockNumber);
    if (blockDiff !== 0) return blockDiff;
    const logIndexA = a.logIndex !== undefined ? Number(a.logIndex) : 0;
    const logIndexB = b.logIndex !== undefined ? Number(b.logIndex) : 0;
    return logIndexA - logIndexB;
  });
}

/**
 * Derive pool state snapshots from Deposit/Withdraw events only
 * @param {Array} events - Sorted pool events
 * @returns {{snapshots: Array, finalState: Object}}
 */
export function derivePoolSnapshotsFromEvents(events) {
  const sortedEvents = sortEventsByBlockAndIndex(events);
  let totalSupply = 0n;
  let expectedLiquidity = 0n;
  let sharePrice = 0n;
  const snapshots = [];

  for (const event of sortedEvents) {
    const amount = BigInt(event.args?.amount ?? event.args?.assets ?? 0n);
    const shares = BigInt(event.args?.shares ?? 0n);
    const blockNumber = Number(event.blockNumber);

    const priceFromEvent = shares > 0n ? (amount * SHARE_PRICE_SCALE) / shares : sharePrice;

    if (event.type === 'Deposit') {
      totalSupply += shares;
      if (shares > 0n && priceFromEvent > 0n) {
        sharePrice = priceFromEvent;
      }
    } else if (event.type === 'Withdraw') {
      totalSupply = totalSupply > shares ? totalSupply - shares : 0n;
      if (shares > 0n && priceFromEvent > 0n) {
        sharePrice = priceFromEvent;
      }
    }

    expectedLiquidity = sharePrice > 0n && totalSupply > 0n
      ? (sharePrice * totalSupply) / SHARE_PRICE_SCALE
      : 0n;

    snapshots.push({
      blockNumber,
      totalSupply,
      expectedLiquidity,
      sharePrice,
      eventType: event.type
    });
  }

  return {
    snapshots,
    finalState: { totalSupply, expectedLiquidity, sharePrice }
  };
}

/**
 * Get pool parameters (daoSplit)
 * @param {string} poolAddress - Pool contract address
 * @param {Object} client - Viem client
 * @returns {Promise<number>} DAO split in basis points
 */
export async function getPoolParameters(poolAddress, client) {
  try {
    const contractDaoSplit = await withRetry(() => client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'daoSplit'
    }), RETRY_OPTIONS);
    return Number(contractDaoSplit);
  } catch (error) {
    console.warn('Could not fetch daoSplit from contract, using default 20%');
    return 2000; // Default 20%
  }
}

/**
 * Get underlying token address
 * @param {string} poolAddress - Pool contract address
 * @param {Object} client - Viem client
 * @returns {Promise<string>} Underlying token address
 */
export async function getUnderlyingToken(poolAddress, client) {
  return await withRetry(() => client.readContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: 'underlyingToken'
  }), RETRY_OPTIONS);
}

/**
 * Get treasury address
 * @param {string} poolAddress
 * @param {Object} client
 * @returns {Promise<string>}
 */
export async function getTreasuryAddress(poolAddress, client) {
  return await withRetry(() => client.readContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: 'treasury'
  }), RETRY_OPTIONS);
}

// ============================================================================
// LP TOKEN BALANCE MANAGEMENT
// ============================================================================

/**
 * Get Transfer events for LP token in a block range
 * @param {string} tokenAddress - LP token contract address
 * @param {number} fromBlock - Starting block number
 * @param {number} toBlock - Ending block number
 * @param {Object} client - Viem client
 * @returns {Promise<Array>} Array of Transfer events sorted by block number
 */
export async function getTransferEvents(tokenAddress, fromBlock, toBlock, client) {
  let batchSize = DEFAULT_MAX_BLOCK_RANGE;
  let currentFromBlock = fromBlock;
  let batchIndex = 0;

  console.log(`🔄 Fetching LP token Transfer events in batches (initial size up to ${batchSize} blocks)...`);

  const allEvents = [];
  
  while (currentFromBlock <= toBlock) {
    const batchToBlock = Math.min(currentFromBlock + batchSize - 1, toBlock);
    
    try {
      const transferLogs = await withRetry(() => client.getLogs({
        address: tokenAddress,
        events: ERC20_TRANSFER_EVENT_ABI,
        fromBlock: BigInt(currentFromBlock),
        toBlock: BigInt(batchToBlock)
      }), RETRY_OPTIONS);
      
      allEvents.push(...transferLogs);
      batchIndex += 1;

      console.log(`   Batch ${batchIndex} (blocks ${currentFromBlock}-${batchToBlock}) completed. Found ${allEvents.length} total events so far.`);

      currentFromBlock = batchToBlock + 1;
      if (currentFromBlock <= toBlock) {
        await sleep(BATCH_DELAY_MS);
      }
    } catch (error) {
      if (isBlockRangeLimitError(error) && batchSize > MIN_BLOCK_RANGE) {
        batchSize = Math.max(MIN_BLOCK_RANGE, Math.floor(batchSize / 2));
        console.warn(`⚠️ RPC limited block range for transfers, reducing batch size to ${batchSize} blocks...`);
        continue;
      }
      console.error(`Error fetching batch ${batchIndex + 1}:`, error.message);
      throw error;
    }
  }
  
  const sortedEvents = allEvents.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  console.log(`✅ Found ${sortedEvents.length} total Transfer events across ${batchIndex} batches`);
  return sortedEvents;
}

/**
 * Derive balances for selected addresses at multiple blocks using Transfer events
 * @param {string} tokenAddress - LP token address
 * @param {number} deployBlock - Block to begin processing events
 * @param {Array<number>} targetBlocks - Blocks to capture balances at
 * @param {Array<string>} addresses - Addresses of interest
 * @param {Object} client - Viem client
 * @returns {Promise<Map<number, Map<string, bigint>>>} Map of block -> (address -> balance)
 */
export async function getAddressBalancesAtBlocksFromEvents(tokenAddress, deployBlock, targetBlocks, addresses, client, options = {}) {
  if (!addresses || addresses.length === 0 || !targetBlocks || targetBlocks.length === 0) {
    return new Map();
  }

  const uniqueTargets = Array.from(new Set(targetBlocks)).sort((a, b) => a - b);
  const maxTargetBlock = uniqueTargets[uniqueTargets.length - 1];
  const normalizedAddresses = addresses.map(addr => addr.toLowerCase());

  const addressSet = new Set(normalizedAddresses);
  const balances = new Map(normalizedAddresses.map(addr => [addr, 0n]));
  const snapshots = new Map();

  const transferEvents = options.transferEvents ?? await getTransferEvents(tokenAddress, deployBlock, maxTargetBlock, client);
  const sortedTransfers = sortEventsByBlockAndIndex(transferEvents);

  let eventIndex = 0;
  for (const targetBlock of uniqueTargets) {
    while (eventIndex < sortedTransfers.length && Number(sortedTransfers[eventIndex].blockNumber) <= targetBlock) {
      const transfer = sortedTransfers[eventIndex];
      const value = BigInt(transfer.args?.value ?? 0n);
      const from = transfer.args?.from?.toLowerCase() ?? '';
      const to = transfer.args?.to?.toLowerCase() ?? '';

      if (addressSet.has(from) && from !== '0x0000000000000000000000000000000000000000') {
        const current = balances.get(from) ?? 0n;
        balances.set(from, current > value ? current - value : 0n);
      }

      if (addressSet.has(to)) {
        const current = balances.get(to) ?? 0n;
        balances.set(to, current + value);
      }

      eventIndex += 1;
    }

    snapshots.set(targetBlock, new Map(balances));
  }

  return snapshots;
}
