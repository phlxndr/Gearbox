/**
 * Pool and events utilities
 */

// ============================================================================
// IMPORTS
// ============================================================================

import { POOL_ABI } from '../config.js';

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
export async function getPoolEvents(poolAddress, fromBlock, toBlock, client, progressCallback = null) {
  const MAX_BLOCK_RANGE = 100000; // RPC limit for paid tier
  const totalBlocks = toBlock - fromBlock;
  const totalBatches = Math.ceil(totalBlocks / MAX_BLOCK_RANGE);
  
  console.log(`🔄 Fetching events in ${totalBatches} batches (max ${MAX_BLOCK_RANGE} blocks per batch)...`);
  
  const allEvents = [];
  
  for (let i = 0; i < totalBatches; i++) {
    const batchFromBlock = fromBlock + (i * MAX_BLOCK_RANGE);
    const batchToBlock = Math.min(batchFromBlock + MAX_BLOCK_RANGE - 1, toBlock);
    
    try {
      const [depositLogs, withdrawLogs] = await Promise.all([
        client.getLogs({
          address: poolAddress,
          events: [{
            type: 'event',
            name: 'Deposit',
            inputs: [
              { indexed: true, name: 'sender', type: 'address' },
              { indexed: false, name: 'amount', type: 'uint256' },
              { indexed: false, name: 'shares', type: 'uint256' }
            ]
          }],
          fromBlock: BigInt(batchFromBlock),
          toBlock: BigInt(batchToBlock)
        }),
        client.getLogs({
          address: poolAddress,
          events: [{
            type: 'event',
            name: 'Withdraw',
            inputs: [
              { indexed: true, name: 'sender', type: 'address' },
              { indexed: false, name: 'amount', type: 'uint256' },
              { indexed: false, name: 'shares', type: 'uint256' }
            ]
          }],
          fromBlock: BigInt(batchFromBlock),
          toBlock: BigInt(batchToBlock)
        })
      ]);
      
      const batchEvents = [
        ...depositLogs.map(log => ({ ...log, type: 'Deposit' })),
        ...withdrawLogs.map(log => ({ ...log, type: 'Withdraw' }))
      ];
      
      allEvents.push(...batchEvents);
      console.log(`   Batch ${i + 1}/${totalBatches} completed. Found ${allEvents.length} total events so far.`);
      
      if (progressCallback) {
        progressCallback({
          stage: 'fetching_events',
          progress: (i + 1) / totalBatches,
          current: i + 1,
          total: totalBatches,
          eventsFound: allEvents.length,
          metrics: { totalRequests: (i + 1) * 2, requestsPerSecond: 'N/A', errorRate: 0 }
        });
      }
    } catch (error) {
      console.error(`Error fetching batch ${i + 1}:`, error.message);
      throw error;
    }
  }
  
  const sortedEvents = allEvents.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  console.log(`✅ Found ${sortedEvents.length} total events across ${totalBatches} batches`);
  return sortedEvents;
}

// ============================================================================
// POOL STATE MANAGEMENT
// ============================================================================

/**
 * Get pool state at a specific block (with caching)
 * @param {string} poolAddress - Pool contract address
 * @param {number} blockNumber - Block number
 * @param {Object} client - Viem client
 * @param {Map} poolStateCache - Pool state cache
 * @param {number} CACHE_TTL - Cache TTL in milliseconds
 * @returns {Promise<Object>} Pool state (totalSupply, expectedLiquidity)
 */
export async function getPoolStateAtBlock(poolAddress, blockNumber, client, poolStateCache, CACHE_TTL) {
  const cacheKey = `${poolAddress}-${blockNumber}`;
  const now = Date.now();
  
  // Check cache first
  if (poolStateCache.has(cacheKey)) {
    const cached = poolStateCache.get(cacheKey);
    if (now - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }
  
  // Fetch from blockchain
  const [totalSupply, expectedLiquidity] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'totalSupply',
      blockNumber: BigInt(blockNumber)
    }),
    client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'expectedLiquidity',
      blockNumber: BigInt(blockNumber)
    })
  ]);
  
  const state = {
    totalSupply: BigInt(totalSupply),
    expectedLiquidity: BigInt(expectedLiquidity)
  };
  
  // Cache the result
  poolStateCache.set(cacheKey, {
    data: state,
    timestamp: now
  });
  
  return state;
}

// ============================================================================
// POOL CONFIGURATION
// ============================================================================

/**
 * Get pool parameters (daoSplit)
 * @param {string} poolAddress - Pool contract address
 * @param {Object} client - Viem client
 * @returns {Promise<number>} DAO split in basis points
 */
export async function getPoolParameters(poolAddress, client) {
  try {
    const contractDaoSplit = await client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'daoSplit'
    });
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
  return await client.readContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: 'underlyingToken'
  });
}
