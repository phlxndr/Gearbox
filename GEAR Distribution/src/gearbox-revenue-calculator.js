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
import { getPoolEvents, derivePoolSnapshotsFromEvents, getPoolParameters, getUnderlyingToken, getAddressBalancesAtBlocksFromEvents, getTreasuryAddress, SHARE_PRICE_SCALE } from './utils/pool-utils.js';
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
export async function calculateGearboxRevenue(
  rpcUrl,
  poolAddress,
  fromDate,
  toDate,
  interestFee,
  revenueShareAddresses = null,
  revenueShareCoeff = null,
  deployDate = null,
  options = {}
) {
  try {
    const { debugSharePrice = false, treasuryAddressOverride = null, daoShareOverride = null } = options ?? {};
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    // Create viem client with provided RPC URL
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl)
    });
    
    // Get cache instances
    const { blockCache, CACHE_TTL } = getCaches();
    
    // ========================================================================
    // INPUT VALIDATION
    // ========================================================================
    
    // Validate and sanitize input parameters
    const sanitized = sanitizeInputParameters(poolAddress, fromDate, toDate, interestFee, deployDate);
    const validation = validateInputParameters(
      sanitized.poolAddress, 
      sanitized.fromDate, 
      sanitized.toDate, 
      sanitized.interestFee,
      sanitized.deployDate
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
    // EVENT FETCHING & STATE RECONSTRUCTION
    // ========================================================================
    
    const APPROX_BLOCKS_PER_DAY = 7200;
    const DEFAULT_LOOKBACK_DAYS = 365;
    const MAX_LOOKBACK_DAYS = DEFAULT_LOOKBACK_DAYS * 5;
    const effectiveDeployDate = sanitized.deployDate || null;
    let deployBlock;
    let automaticLookbackDays = null;
    
    if (effectiveDeployDate) {
      deployBlock = await dateToStartBlock(effectiveDeployDate, client);
      if (deployBlock > fromBlock) {
        console.warn('Provided deployDate falls after the requested fromDate. Using fromDate as deploy point.');
        deployBlock = fromBlock;
      }
    } else {
      // No explicit deploy date: start with a 1-year lookback window so we can pick up
      // the first deposit before the requested range and iterate if that wasn't enough.
      automaticLookbackDays = DEFAULT_LOOKBACK_DAYS;
      const lookbackBlocks = automaticLookbackDays * APPROX_BLOCKS_PER_DAY;
      deployBlock = Math.max(0, fromBlock - lookbackBlocks);
      console.log(`ℹ️ No deployDate provided; backfilling approximately ${automaticLookbackDays} days of events (~${lookbackBlocks} blocks).`);
    }
    
    let allEvents = [];
    let transferEventsAll = [];
    let snapshots = [];
    while (true) {
      // Pull deposit/withdraw logs for the current lookback window.
      console.log(`🔍 Fetching pool events from block ${deployBlock} to ${toBlock}...`);
      const { events: fetchedEvents, transferEvents = [] } = await getPoolEvents(
        sanitized.poolAddress,
        deployBlock,
        toBlock,
        client,
        { includeTransfers: true }
      );
      allEvents = fetchedEvents;
      transferEventsAll = transferEvents;
      
      console.log('📊 Deriving pool state timeline from events...');
      const derived = derivePoolSnapshotsFromEvents(allEvents);
      snapshots = derived.snapshots;
      
      const stateBeforePeriod = [...snapshots].reverse().find(snapshot => snapshot.blockNumber < fromBlock);
      // We only trust the reconstruction if we saw non-zero supply before fromBlock.
      const hasSupplyBeforePeriod = stateBeforePeriod ? stateBeforePeriod.totalSupply > 0n : false;
      
      if (effectiveDeployDate) {
        if (!hasSupplyBeforePeriod) {
          console.warn('⚠️ No deposits found before the requested range using provided deployDate. TVL will remain zero if the pool was funded earlier.');
        }
        break;
      }
      
      if (hasSupplyBeforePeriod || deployBlock === 0) {
        if (!hasSupplyBeforePeriod) {
          console.warn('⚠️ No deposits detected before the requested range even after reaching genesis. TVL may be zero.');
        }
        break;
      }
      
      if (automaticLookbackDays >= MAX_LOOKBACK_DAYS) {
        console.warn(`⚠️ No deposits detected before the requested range within ~${automaticLookbackDays} days of history. Provide --deploy-date to scan further back.`);
        break;
      }
      
      // Double the time window (bounded) to continue hunting for the initial deposit.
      const newLookbackDays = Math.min(MAX_LOOKBACK_DAYS, automaticLookbackDays * 2);
      const newDeployBlock = Math.max(0, fromBlock - newLookbackDays * APPROX_BLOCKS_PER_DAY);
      
      if (newDeployBlock === deployBlock) {
        console.warn('⚠️ Unable to extend lookback further. TVL may remain zero if earlier deposits exist.');
        break;
      }
      
      automaticLookbackDays = newLookbackDays;
      deployBlock = newDeployBlock;
      console.log(`ℹ️ Expanding automatic lookback to approximately ${automaticLookbackDays} days (block ${deployBlock}).`);
    }
    
    const deployBlockNote = effectiveDeployDate
      ? ` derived from ${effectiveDeployDate}`
      : automaticLookbackDays
        ? ` (~${automaticLookbackDays} days back)`
        : '';
    console.log(`🛠️ Using deploy block ${deployBlock}${deployBlockNote}`);
    
    const eventsInRange = allEvents.filter(event => {
      const blockNumber = Number(event.blockNumber);
      return blockNumber >= fromBlock && blockNumber <= toBlock;
    });
    console.log(`✅ Retrieved ${allEvents.length} events since deploy; ${eventsInRange.length} fall inside the target window.`);
    
    const initialTimestamp = await getBlockTimestamp(fromBlock, client, blockCache, CACHE_TTL);
    const finalTimestamp = await getBlockTimestamp(toBlock, client, blockCache, CACHE_TTL);
    let actualFromBlock = fromBlock;
    let actualToBlock = toBlock;
    let actualFromTimestamp = initialTimestamp;
    let actualToTimestamp = finalTimestamp;
    let anchorSnapshots = [];
    let anchorTimestamps = [];
    
    if (snapshots.length === 0) {
      throw new Error('No deposit/withdraw events found to build pool state.');
    }

    const findNearestSnapshotIndex = (targetBlock) => {
      let bestIndex = 0;
      let bestDiff = Math.abs(Number(snapshots[0].blockNumber) - targetBlock);
      for (let i = 1; i < snapshots.length; i++) {
        const diff = Math.abs(Number(snapshots[i].blockNumber) - targetBlock);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIndex = i;
        }
      }
      return bestIndex;
    };

    let startIdx = findNearestSnapshotIndex(fromBlock);
    let endIdx = findNearestSnapshotIndex(toBlock);
    if (startIdx > endIdx) {
      const tmp = startIdx;
      startIdx = endIdx;
      endIdx = tmp;
    }

    anchorSnapshots = snapshots.slice(startIdx, endIdx + 1);
    if (anchorSnapshots.length < 2) {
      throw new Error('Not enough events to compute revenue within the requested period.');
    }

    anchorTimestamps = await Promise.all(anchorSnapshots.map(snapshot =>
      getBlockTimestamp(snapshot.blockNumber, client, blockCache, CACHE_TTL)
    ));

    actualFromBlock = anchorSnapshots[0].blockNumber;
    actualToBlock = anchorSnapshots[anchorSnapshots.length - 1].blockNumber;
    actualFromTimestamp = anchorTimestamps[0];
    actualToTimestamp = anchorTimestamps[anchorTimestamps.length - 1];

    if (actualFromBlock !== fromBlock) {
      console.warn(`⚠️ Unable to anchor precisely at start block ${fromBlock}. Using nearest event block ${actualFromBlock}.`);
    }
    if (actualToBlock !== toBlock) {
      console.warn(`⚠️ Unable to anchor precisely at end block ${toBlock}. Using nearest event block ${actualToBlock}.`);
    }

    console.log(`   Effective coverage anchored between blocks ${actualFromBlock} and ${actualToBlock}.`);

    console.log('✅ Pool state interpolation setup complete');

    // ========================================================================
    // POOL CONFIGURATION
    // ========================================================================
    
    console.log('⚙️ Fetching pool parameters...');
    let finalDaoSplit = await getPoolParameters(sanitized.poolAddress, client);
    if (daoShareOverride !== null) {
      console.log(`   Overriding DAO share from ${finalDaoSplit} bps to ${daoShareOverride} bps`);
      finalDaoSplit = daoShareOverride;
    }
    
    console.log('🪙 Getting underlying token...');
    const underlyingToken = await getUnderlyingToken(sanitized.poolAddress, client);

    let treasuryAddress = treasuryAddressOverride ? treasuryAddressOverride.toLowerCase() : null;
    if (!treasuryAddress) {
      console.log('🏦 Fetching treasury address (latest)...');
      treasuryAddress = (await getTreasuryAddress(sanitized.poolAddress, client))?.toLowerCase();
    }
    
    // ========================================================================
    // INTERVAL PROCESSING & METRICS
    // ========================================================================
    
    console.log('🔄 Processing intervals and calculating aggregates...');
    let totalRevenue = 0n;
    let weightedTVLSum = 0n;
    let totalTimeSum = 0;
    const fallbackIntervals = 0;
    const fallbackTimeSum = 0;
    
    let negativeSharePriceIntervals = 0;
    let negativeSharePriceDiff = 0n;
    
    const SCALE = SHARE_PRICE_SCALE;
    for (let i = 0; i < anchorSnapshots.length - 1; i++) {
      const current = anchorSnapshots[i];
      const next = anchorSnapshots[i + 1];
      const currentTimestamp = anchorTimestamps[i];
      const nextTimestamp = anchorTimestamps[i + 1];
      const timeDelta = nextTimestamp - currentTimestamp;
      if (timeDelta <= 0) continue;
      const sharePriceDiff = next.sharePrice - current.sharePrice;
      const intervalRevenue = (current.totalSupply * sharePriceDiff) / SCALE;
      if (sharePriceDiff < 0n) {
        negativeSharePriceIntervals += 1;
        negativeSharePriceDiff += sharePriceDiff;
      }
      totalRevenue += intervalRevenue;
      if (debugSharePrice && sharePriceDiff !== 0n) {
        console.log(
          `   [SharePrice] blocks ${current.blockNumber}->${next.blockNumber}: prev=${current.sharePrice.toString()} new=${next.sharePrice.toString()} ` +
          `diff=${sharePriceDiff.toString()} revenueImpact=${intervalRevenue.toString()} totalRevenue=${totalRevenue.toString()}`
        );
      }
      const intervalTVL = current.expectedLiquidity;
      weightedTVLSum += intervalTVL * BigInt(timeDelta);
      totalTimeSum += timeDelta;
    }
    
    if (negativeSharePriceIntervals > 0) {
      console.warn(`ℹ️ Share price declined in ${negativeSharePriceIntervals} intervals (cumulative diff ${negativeSharePriceDiff.toString()} scaled units). Declines are applied to revenue totals.`);
    }

    const transferEventsForRange = (transferEventsAll ?? []).filter(event => {
      const blockNumber = Number(event.blockNumber);
      return blockNumber >= actualFromBlock && blockNumber <= actualToBlock;
    });
    const lpTokenAddress = sanitized.poolAddress;

    // ========================================================================
    // REALIZED REVENUE (DAO MINTS)
    // ========================================================================

    console.log('🏁 Calculating realized revenue from treasury mints...');
    let realizedSharesMinted = 0n;
    let realizedRevenueRaw = 0n;
    if (treasuryAddress) {
      for (const event of transferEventsForRange) {
        const from = event.args?.from?.toLowerCase?.() ?? '';
        const to = event.args?.to?.toLowerCase?.() ?? '';
        if (from === '0x0000000000000000000000000000000000000000' && to === treasuryAddress) {
          const value = BigInt(event.args?.value ?? 0n);
          realizedSharesMinted += value;
        }
      }
      const daoSplitBps = BigInt(finalDaoSplit);
      const realizedDaoShares = (realizedSharesMinted * daoSplitBps) / 10000n;
      const finalSharePrice = anchorSnapshots[anchorSnapshots.length - 1].sharePrice;
      realizedRevenueRaw = (realizedDaoShares * finalSharePrice) / SHARE_PRICE_SCALE;
      console.log(`   Realized shares minted to treasury: ${realizedSharesMinted.toString()} -> DAO share ${realizedDaoShares.toString()}`);
    } else {
      console.warn('⚠️ Treasury address unavailable. Skipping realized revenue calculation.');
    }
    
    // ========================================================================
    // REVENUE SHARE CALCULATION (if enabled)
    // ========================================================================
    
    let addressesWeightedTVL = 0n;
    
    if (revenueShareAddresses && revenueShareAddresses.length > 0 && revenueShareCoeff !== null) {
      console.log('💰 Calculating revenue share for selected addresses...');
      console.log(`   Selected addresses: ${revenueShareAddresses.length}`);
      console.log(`   Revenue share coefficient: ${revenueShareCoeff}`);
      
      console.log('   Using cached transfer events for revenue share calculations...');
      const transferEvents = transferEventsForRange;
      
      // Get unique block numbers where transfers occurred in the period
      const transferBlocks = [...new Set(transferEvents
        .filter(e => {
          const eventBlock = Number(e.blockNumber);
          return eventBlock >= actualFromBlock && eventBlock <= actualToBlock;
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
      const allBalanceCheckBlocks = [actualFromBlock, ...relevantBlocks, actualToBlock].filter((block, idx, arr) => arr.indexOf(block) === idx).sort((a, b) => a - b);
      
      console.log(`   Checking balances at ${allBalanceCheckBlocks.length} key blocks...`);
      
      // Get balances at each key block
      const balanceCheckPromises = allBalanceCheckBlocks.map(blockNumber =>
        getBlockTimestamp(blockNumber, client, blockCache, CACHE_TTL).then(timestamp => ({
          blockNumber,
          timestamp
        }))
      );
      
      const balanceCheckTimes = await Promise.all(balanceCheckPromises);
      
      const balanceSnapshots = await getAddressBalancesAtBlocksFromEvents(
        lpTokenAddress,
        actualFromBlock,
        allBalanceCheckBlocks,
        revenueShareAddresses,
        client,
        { transferEvents: transferEventsForRange }
      );
      
      let addressesTotalBalance = 0n;
      
      for (let i = 0; i < balanceCheckTimes.length - 1; i++) {
        const current = balanceCheckTimes[i];
        const next = balanceCheckTimes[i + 1];
        const balances = balanceSnapshots.get(current.blockNumber) ?? new Map();
        
        let totalBalance = 0n;
        for (const balance of balances.values()) {
          totalBalance += balance;
        }
        
        const timeDelta = next.timestamp - current.timestamp;
        if (timeDelta > 0) {
          addressesTotalBalance += totalBalance * BigInt(timeDelta);
        }
      }
      
      addressesWeightedTVL = totalTimeSum > 0 ? addressesTotalBalance / BigInt(totalTimeSum) : 0n;
      
      console.log(`✅ Addresses weighted TVL calculated: ${addressesWeightedTVL.toString()}`);
    }
    
    // ========================================================================
    // FEE APPLICATION AND FINALIZATION
    // ========================================================================
    
    // Calculate averages and apply fees
    const requestedPeriodSeconds = Math.max(finalTimestamp - initialTimestamp, 0);
    const effectiveCoverageSeconds = totalTimeSum;
    const coverageRatio = requestedPeriodSeconds > 0
      ? Math.min(effectiveCoverageSeconds / requestedPeriodSeconds, 1)
      : 0;
    const avgTVL = totalTimeSum > 0 ? weightedTVLSum / BigInt(totalTimeSum) : 0n;
    
    // Apply interest fee to total revenue first
    const interestFeeRate = sanitized.interestFee / 10000; // Convert basis points to decimal
    const revenueWithInterestFee = (totalRevenue * BigInt(Math.floor(interestFeeRate * 10000))) / 10000n;
    
    // Then apply DAO split to the interest fee revenue
    const daoSplitRate = finalDaoSplit / 10000; // Assuming basis points
    const finalRevenueForDAO = (revenueWithInterestFee * BigInt(Math.floor(daoSplitRate * 10000))) / 10000n;
    const realizedRevenueForDAO = realizedRevenueRaw;
    const totalRevenueForDAO = finalRevenueForDAO + realizedRevenueForDAO;
    
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
    
    const deployDateUsed = effectiveDeployDate ?? `~${(automaticLookbackDays ?? DEFAULT_LOOKBACK_DAYS)}d lookback`;
    const result = {
      pool: sanitized.poolAddress,
      fromDate: sanitized.fromDate,
      toDate: sanitized.toDate,
      avgTVL: (Number(avgTVL) / Math.pow(10, tokenDecimals)).toFixed(6),
      generatedRevenue: (Number(finalRevenueForDAO) / Math.pow(10, tokenDecimals)).toFixed(6),
      // Additional debug info
      totalEvents: eventsInRange.length,
      totalRevenueRaw: totalRevenue.toString(),
      realizedRevenueRaw: realizedRevenueForDAO.toString(),
      totalRevenueWithRealizedRaw: totalRevenueForDAO.toString(),
      avgTVLRaw: avgTVL.toString(),
      requestedPeriodSeconds,
      dataCoverageSeconds: totalTimeSum,
      fallbackCoverageSeconds: fallbackTimeSum,
      coverageRatio,
      fallbackIntervals,
      negativeSharePriceIntervals,
      actualFromBlock,
      actualToBlock,
      actualFromTimestamp,
      actualToTimestamp,
      deployDate: deployDateUsed,
      deployBlock,
      realizedRevenueDao: realizedRevenueForDAO.toString(),
      unrealizedRevenueDao: finalRevenueForDAO.toString(),
      totalRevenueDao: totalRevenueForDAO.toString(),
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
    result.realizedRevenue = (Number(realizedRevenueForDAO) / Math.pow(10, tokenDecimals)).toFixed(6);
    result.unrealizedRevenue = (Number(finalRevenueForDAO) / Math.pow(10, tokenDecimals)).toFixed(6);
    result.totalRevenue = (Number(totalRevenueForDAO) / Math.pow(10, tokenDecimals)).toFixed(6);
    
    return result;
    
  } catch (error) {
    console.error('Error in calculateGearboxRevenue:', error);
    throw new Error(formatErrorMessage(error));
  }
}
