/**
 * Main Gearbox Revenue Calculator
 */

// ============================================================================
// IMPORTS
// ============================================================================

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { validateInputParameters, sanitizeInputParameters, formatErrorMessage } from './utils/validation.js';
import { dateToStartBlock, dateToEndBlock, getBlockTimestamp } from './utils/block-utils.js';
import { getPoolEvents, getPoolStateAtBlock, getPoolParameters, getUnderlyingToken, getTransferEvents, getLPBalancesAtBlock } from './utils/pool-utils.js';
import { getTokenName, getTokenDecimals } from './utils/token-utils.js';
import { getCaches } from './utils/cache-utils.js';

/**
 * Main function to calculate weighted average TVL and potential revenue
 * @param {string} rpcUrl - Ethereum RPC endpoint URL
 * @param {string} poolAddress - Pool contract address
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @param {number} interestFee - Interest fee in basis points (0-10000)
 * @param {Array<string>} revenueShareAddresses - Optional array of addresses for revenue sharing
 * @param {number} revenueShareCoeff - Optional revenue share coefficient (0-1)
 * @returns {Promise<Object>} Calculation results
 */
export async function calculateGearboxRevenue(rpcUrl, poolAddress, fromDate, toDate, interestFee, revenueShareAddresses = null, revenueShareCoeff = null) {
  try {
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    // Create viem client with provided RPC URL
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl)
    });
    
    // Get cache instances
    const { blockCache, poolStateCache, CACHE_TTL } = getCaches();
    
    // ========================================================================
    // INPUT VALIDATION
    // ========================================================================
    
    // Validate and sanitize input parameters
    const sanitized = sanitizeInputParameters(poolAddress, fromDate, toDate, interestFee);
    const validation = validateInputParameters(
      sanitized.poolAddress, 
      sanitized.fromDate, 
      sanitized.toDate, 
      sanitized.interestFee
    );
    
    if (!validation.isValid) {
      throw new Error(`Input validation failed: ${validation.errors.join(', ')}`);
    }
    
    console.log(`🚀 Starting calculation for pool ${sanitized.poolAddress} from ${sanitized.fromDate} to ${sanitized.toDate}`);
    
    // ========================================================================
    // BLOCK CONVERSION
    // ========================================================================
    
    // Step 1: Convert dates to blocks with precise time boundaries
    console.log('📅 Converting dates to blocks...');
    const fromBlock = await dateToStartBlock(sanitized.fromDate, client);
    const toBlock = await dateToEndBlock(sanitized.toDate, client);
    
    console.log(`✅ Date range converted to blocks: ${fromBlock} to ${toBlock}`);
    console.log(`   From: ${sanitized.fromDate} 00:01 UTC (block ${fromBlock})`);
    console.log(`   To: ${sanitized.toDate} 23:59 UTC (block ${toBlock})`);
    
    // ========================================================================
    // EVENT FETCHING
    // ========================================================================
    
    // Step 2: Get pool events in the range
    console.log('🔍 Fetching pool events...');
    const events = await getPoolEvents(sanitized.poolAddress, fromBlock, toBlock, client);
    console.log(`✅ Found ${events.length} events in the range`);
    
    // ========================================================================
    // POOL STATE INITIALIZATION
    // ========================================================================
    
    // Step 3: Get initial and final pool states
    console.log('📊 Getting pool states...');
    const initialState = await getPoolStateAtBlock(sanitized.poolAddress, fromBlock, client, poolStateCache, CACHE_TTL);
    const initialTimestamp = await getBlockTimestamp(fromBlock, client, blockCache, CACHE_TTL);
    const finalState = await getPoolStateAtBlock(sanitized.poolAddress, toBlock, client, poolStateCache, CACHE_TTL);
    const finalTimestamp = await getBlockTimestamp(toBlock, client, blockCache, CACHE_TTL);
    
    // ========================================================================
    // POOL CONFIGURATION
    // ========================================================================
    
    // Step 4: Get pool parameters
    console.log('⚙️ Fetching pool parameters...');
    const finalDaoSplit = await getPoolParameters(sanitized.poolAddress, client);
    
    // Step 5: Get underlying token address
    console.log('🪙 Getting underlying token...');
    const underlyingToken = await getUnderlyingToken(sanitized.poolAddress, client);
    
    // ========================================================================
    // POOL STATE INTERPOLATION SETUP
    // ========================================================================
    
    // Step 6: Process events and calculate intervals
    console.log('🔄 Processing events and calculating intervals...');
    let totalRevenue = 0n;
    let weightedTVLSum = 0n;
    let totalTimeSum = 0;
    const intervals = [];
    
    console.log('📊 Setting up pool state interpolation...');
    
    // Always search for events before and after the range to get proper pool states
    const searchRange = 7 * 24 * 60 * 60; // 7 days in seconds
    const searchFromBlock = Math.max(0, fromBlock - Math.floor(searchRange / 12)); // ~7 days before
    const searchToBlock = toBlock + Math.floor(searchRange / 12); // ~7 days after
    
    console.log(`🔍 Searching for events from block ${searchFromBlock} to ${searchToBlock}...`);
    
    const [beforeEvents, afterEvents] = await Promise.all([
      getPoolEvents(sanitized.poolAddress, searchFromBlock, fromBlock - 1, client),
      getPoolEvents(sanitized.poolAddress, toBlock + 1, searchToBlock, client)
    ]);
    
    console.log(`   Found ${beforeEvents.length} events before period, ${afterEvents.length} events after period`);
    console.log(`   Found ${events.length} events within period`);
    
    // Get pool states at key points
    let startState = initialState;
    let endState = finalState;
    
    // For start point: use state after last event before the period
    if (beforeEvents.length > 0) {
      const lastBeforeEvent = beforeEvents[beforeEvents.length - 1];
      const beforeBlockNumber = Number(lastBeforeEvent.blockNumber);
      startState = await getPoolStateAtBlock(sanitized.poolAddress, beforeBlockNumber, client, poolStateCache, CACHE_TTL);
      console.log(`   Using pool state from block ${beforeBlockNumber} (last event before period)`);
    } else {
      console.log(`   Using initial pool state from block ${fromBlock}`);
    }
    
    // For end point: use state after last event up to the end of period
    const allEventsInPeriod = [...beforeEvents, ...events, ...afterEvents].filter(event => {
      const eventBlock = Number(event.blockNumber);
      return eventBlock <= toBlock;
    });
    
    if (allEventsInPeriod.length > 0) {
      const lastEventInPeriod = allEventsInPeriod[allEventsInPeriod.length - 1];
      const lastEventBlock = Number(lastEventInPeriod.blockNumber);
      endState = await getPoolStateAtBlock(sanitized.poolAddress, lastEventBlock, client, poolStateCache, CACHE_TTL);
      console.log(`   Using pool state from block ${lastEventBlock} (last event up to end of period)`);
    } else {
      console.log(`   Using final pool state from block ${toBlock}`);
    }
    
    // ========================================================================
    // INTERVAL PROCESSING
    // ========================================================================
    
    // Add start point
    intervals.push({ blockNumber: fromBlock, timestamp: initialTimestamp, ...startState });
    
    // Add events within the period
    if (events.length > 0) {
      console.log(`🔄 Processing ${events.length} event blocks within period...`);
      
      const BATCH_SIZE = 100;
      const PARALLEL_BATCHES = 3;
      
      for (let i = 0; i < events.length; i += BATCH_SIZE * PARALLEL_BATCHES) {
        const parallelBatchPromises = [];
        
        for (let j = 0; j < PARALLEL_BATCHES && i + j * BATCH_SIZE < events.length; j++) {
          const batchStart = i + j * BATCH_SIZE;
          const batchEnd = Math.min(batchStart + BATCH_SIZE, events.length);
          const batch = events.slice(batchStart, batchEnd);
          
          const batchPromise = (async () => {
            const batchPromises = batch.map(async (event) => {
              const blockNumber = Number(event.blockNumber);
              const [timestamp, state] = await Promise.all([
                getBlockTimestamp(blockNumber, client, blockCache, CACHE_TTL),
                getPoolStateAtBlock(sanitized.poolAddress, blockNumber, client, poolStateCache, CACHE_TTL)
              ]);
              return { blockNumber, timestamp, ...state };
            });
            return await Promise.all(batchPromises);
          })();
          parallelBatchPromises.push(batchPromise);
        }
        
        const parallelResults = await Promise.all(parallelBatchPromises);
        for (const batchResults of parallelResults) {
          intervals.push(...batchResults);
        }
        
        const processed = Math.min(i + BATCH_SIZE * PARALLEL_BATCHES, events.length);
        const percentage = ((processed / events.length) * 100).toFixed(1);
        console.log(`   Processed ${processed}/${events.length} events (${percentage}%)`);
        
        if (processed < events.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    
    // Add end point
    intervals.push({ blockNumber: toBlock, timestamp: finalTimestamp, ...endState });
    
    console.log('✅ Pool state interpolation setup complete');
    
    // ========================================================================
    // REVENUE AND TVL CALCULATION
    // ========================================================================
    
    // Step 7: Calculate revenue and TVL
    console.log('💰 Calculating revenue and TVL...');
    
    for (let i = 0; i < intervals.length - 1; i++) {
      const current = intervals[i];
      const next = intervals[i + 1];
      
      const timeDelta = next.timestamp - current.timestamp;
      if (timeDelta <= 0) continue;
      
      // Calculate share price (expectedLiquidity / totalSupply)
      const currentSharePrice = current.totalSupply > 0n 
        ? (current.expectedLiquidity * 1000000n) / current.totalSupply // Scale by 1e6 for precision
        : 0n;
      
      const nextSharePrice = next.totalSupply > 0n 
        ? (next.expectedLiquidity * 1000000n) / next.totalSupply
        : 0n;
      
      // Revenue = TotalShares * (SharePrice(i+1) - SharePrice(i))
      const sharePriceDiff = nextSharePrice - currentSharePrice;
      const intervalRevenue = (current.totalSupply * sharePriceDiff) / 1000000n;
      
      // TVL = TotalShares * SharePrice
      const intervalTVL = (current.totalSupply * currentSharePrice) / 1000000n;
      
      totalRevenue += intervalRevenue;
      weightedTVLSum += intervalTVL * BigInt(timeDelta);
      totalTimeSum += timeDelta;
    }
    
    // ========================================================================
    // REVENUE SHARE CALCULATION (if enabled)
    // ========================================================================
    
    let addressesWeightedTVL = 0n;
    
    if (revenueShareAddresses && revenueShareAddresses.length > 0 && revenueShareCoeff !== null) {
      console.log('💰 Calculating revenue share for selected addresses...');
      console.log(`   Selected addresses: ${revenueShareAddresses.length}`);
      console.log(`   Revenue share coefficient: ${revenueShareCoeff}`);
      
      // The pool address IS the LP token address
      const lpTokenAddress = sanitized.poolAddress;
      
      // Search for events in expanded range for interpolation
      const searchFromBlock = Math.max(0, fromBlock - Math.floor(searchRange / 12));
      const searchToBlock = toBlock + Math.floor(searchRange / 12);
      
      console.log(`🔍 Fetching LP token Transfer events from block ${searchFromBlock} to ${searchToBlock}...`);
      const transferEvents = await getTransferEvents(lpTokenAddress, searchFromBlock, searchToBlock, client);
      
      // Get unique block numbers where transfers occurred in the period
      const transferBlocks = [...new Set(transferEvents
        .filter(e => {
          const eventBlock = Number(e.blockNumber);
          return eventBlock >= fromBlock && eventBlock <= toBlock;
        })
        .map(e => Number(e.blockNumber))
      )].sort((a, b) => a - b);
      
      // Filter transfers that involve our selected addresses
      const relevantBlocks = transferBlocks.filter(blockNum => {
        const blockTransfers = transferEvents.filter(e => Number(e.blockNumber) === blockNum);
        return blockTransfers.some(transfer => {
          const from = transfer.args?.from?.toLowerCase();
          const to = transfer.args?.to?.toLowerCase();
          return revenueShareAddresses.some(addr => 
            addr.toLowerCase() === from || addr.toLowerCase() === to
          );
        });
      });
      
      console.log(`   Found ${relevantBlocks.length} blocks with transfers involving selected addresses`);
      
      // Add start and end blocks
      const allBalanceCheckBlocks = [fromBlock, ...relevantBlocks, toBlock].filter((block, idx, arr) => arr.indexOf(block) === idx).sort((a, b) => a - b);
      
      console.log(`   Checking balances at ${allBalanceCheckBlocks.length} key blocks...`);
      
      // Get balances at each key block
      const balanceCheckPromises = allBalanceCheckBlocks.map(blockNumber => 
        getBlockTimestamp(blockNumber, client, blockCache, CACHE_TTL).then(timestamp => ({
          blockNumber,
          timestamp
        }))
      );
      
      const balanceCheckTimes = await Promise.all(balanceCheckPromises);
      
      // Process in batches to avoid RPC overload
      const BATCH_SIZE = 20;
      let addressesTotalBalance = 0n;
      
      for (let i = 0; i < balanceCheckTimes.length - 1; i += BATCH_SIZE) {
        const batch = balanceCheckTimes.slice(i, Math.min(i + BATCH_SIZE, balanceCheckTimes.length));
        
        const batchPromises = batch.map(async ({ blockNumber, timestamp }) => {
          const balances = await getLPBalancesAtBlock(lpTokenAddress, revenueShareAddresses, blockNumber, client);
          
          // Sum all balances
          let totalBalance = 0n;
          for (const balance of balances.values()) {
            totalBalance += balance;
          }
          
          return { blockNumber, timestamp, totalBalance };
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        // Calculate weighted sum for this batch
        for (let j = 0; j < batchResults.length - 1; j++) {
          const current = batchResults[j];
          const next = batchResults[j + 1];
          
          const timeDelta = next.timestamp - current.timestamp;
          if (timeDelta > 0) {
            addressesTotalBalance += current.totalBalance * BigInt(timeDelta);
          }
        }
        
        console.log(`   Processed ${Math.min(i + BATCH_SIZE, balanceCheckTimes.length)}/${balanceCheckTimes.length} balance checks`);
      }
      
      addressesWeightedTVL = totalTimeSum > 0 ? addressesTotalBalance / BigInt(totalTimeSum) : 0n;
      
      console.log(`✅ Addresses weighted TVL calculated: ${addressesWeightedTVL.toString()}`);
    }
    
    // ========================================================================
    // FEE APPLICATION AND FINALIZATION
    // ========================================================================
    
    // Calculate averages and apply fees
    const avgTVL = totalTimeSum > 0 ? weightedTVLSum / BigInt(totalTimeSum) : 0n;
    
    // Apply interest fee to total revenue first
    const interestFeeRate = sanitized.interestFee / 10000; // Convert basis points to decimal
    const revenueWithInterestFee = (totalRevenue * BigInt(Math.floor(interestFeeRate * 10000))) / 10000n;
    
    // Then apply DAO split to the interest fee revenue
    const daoSplitRate = finalDaoSplit / 10000; // Assuming basis points
    const finalRevenueForDAO = (revenueWithInterestFee * BigInt(Math.floor(daoSplitRate * 10000))) / 10000n;
    
    // Get token decimals for proper formatting
    console.log('🔢 Getting token decimals...');
    const tokenDecimals = await getTokenDecimals(underlyingToken, client);
    
    // Calculate revenue share if enabled
    let revenueShare = null;
    if (revenueShareAddresses && revenueShareAddresses.length > 0 && revenueShareCoeff !== null) {
      // Formula: (addresses_TW_TVL / pool_TW_TVL) * pool_revenue * rev_share_coeff
      // Use totalRevenue (before fees), not finalRevenueForDAO
      if (avgTVL > 0n && addressesWeightedTVL > 0n && totalRevenue > 0n) {
        const addressesShareRatio = (addressesWeightedTVL * 1000000n) / avgTVL; // Scale by 1e6
        const poolRevenueScaled = totalRevenue * BigInt(Math.floor(revenueShareCoeff * 10000));
        revenueShare = (addressesShareRatio * poolRevenueScaled) / 10000000000n; // Scale back
      }
      console.log(`✅ Revenue share calculated: ${revenueShare ? revenueShare.toString() : '0'}`);
    }
    
    // Finish calculation
    console.log('🎉 Calculation completed successfully!');
    
    // ========================================================================
    // RESULT PREPARATION
    // ========================================================================
    
    const result = {
      pool: sanitized.poolAddress,
      fromDate: sanitized.fromDate,
      toDate: sanitized.toDate,
      avgTVL: (Number(avgTVL) / Math.pow(10, tokenDecimals)).toFixed(6),
      generatedRevenue: (Number(finalRevenueForDAO) / Math.pow(10, tokenDecimals)).toFixed(6),
      // Additional debug info
      totalEvents: events.length,
      totalRevenueRaw: totalRevenue.toString(),
      avgTVLRaw: avgTVL.toString(),
      interestFee: sanitized.interestFee,
      daoSplit: finalDaoSplit,
      underlyingToken,
      underlyingTokenName: await getTokenName(underlyingToken, client),
      tokenDecimals: tokenDecimals
    };
    
    // Add revenue share info if calculated
    if (revenueShare !== null) {
      result.addressesWeightedTVL = (Number(addressesWeightedTVL) / Math.pow(10, tokenDecimals)).toFixed(6);
      result.revenueShare = (Number(revenueShare) / Math.pow(10, tokenDecimals)).toFixed(6);
      result.revenueShareAddresses = revenueShareAddresses;
      result.revenueShareCoeff = revenueShareCoeff;
    }
    
    return result;
    
  } catch (error) {
    console.error('Error in calculateGearboxRevenue:', error);
    throw new Error(formatErrorMessage(error));
  }
}
