/**
 * Block and date utilities
 */

// ============================================================================
// DATE TO BLOCK CONVERSION
// ============================================================================

/**
 * Convert date string to start block (00:01 UTC)
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {Object} client - Viem client
 * @returns {Promise<number>} Block number
 */
export async function dateToStartBlock(dateString, client) {
  // Convert to start of day (00:01 UTC)
  const date = new Date(dateString);
  date.setUTCHours(0, 1, 0, 0); // 00:01 UTC
  const targetTimestamp = Math.floor(date.getTime() / 1000);
  
  // Get latest block to establish upper bound
  const latestBlock = await client.getBlockNumber();
  let low = 0;
  let high = Number(latestBlock);
  
  // Binary search for the block with timestamp closest to target
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const block = await client.getBlock({ blockNumber: BigInt(mid) });
    const blockTimestamp = Number(block.timestamp);
    
    if (blockTimestamp === targetTimestamp) {
      return mid;
    } else if (blockTimestamp < targetTimestamp) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  
  return high;
}

/**
 * Convert date string to end block (23:59 UTC)
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {Object} client - Viem client
 * @returns {Promise<number>} Block number
 */
export async function dateToEndBlock(dateString, client) {
  // Convert to end of day (23:59 UTC)
  const date = new Date(dateString);
  date.setUTCHours(23, 59, 0, 0); // 23:59 UTC
  const targetTimestamp = Math.floor(date.getTime() / 1000);
  
  // Get latest block to establish upper bound
  const latestBlock = await client.getBlockNumber();
  let low = 0;
  let high = Number(latestBlock);
  
  // Binary search for the block with timestamp closest to target
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const block = await client.getBlock({ blockNumber: BigInt(mid) });
    const blockTimestamp = Number(block.timestamp);
    
    if (blockTimestamp === targetTimestamp) {
      return mid;
    } else if (blockTimestamp < targetTimestamp) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  
  return high;
}

// ============================================================================
// BLOCK TIMESTAMP UTILITIES
// ============================================================================

/**
 * Get block timestamp (with caching)
 * @param {number} blockNumber - Block number
 * @param {Object} client - Viem client
 * @param {Map} blockCache - Block cache
 * @param {number} CACHE_TTL - Cache TTL in milliseconds
 * @returns {Promise<number>} Block timestamp
 */
export async function getBlockTimestamp(blockNumber, client, blockCache, CACHE_TTL) {
  const cacheKey = `block-${blockNumber}`;
  const now = Date.now();
  
  // Check cache first
  if (blockCache.has(cacheKey)) {
    const cached = blockCache.get(cacheKey);
    if (now - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }
  
  // Fetch from blockchain
  const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
  const timestamp = Number(block.timestamp);
  
  // Cache the result
  blockCache.set(cacheKey, {
    data: timestamp,
    timestamp: now
  });
  
  return timestamp;
}
