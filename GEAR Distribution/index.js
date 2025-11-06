#!/usr/bin/env node

/**
 * Gearbox Revenue Calculator - Main Entry Point
 * 
 * This script demonstrates how to use the calculateGearboxRevenue function
 * to calculate weighted average TVL and potential revenue for Gearbox DAO.
 */

import { calculateGearboxRevenue } from './src/gearbox-revenue-calculator.js';
import { validateInputParameters, formatErrorMessage } from './src/utils/validation.js';

/**
 * Main function to run the calculator
 */
async function main() {
  console.log('🚀 Gearbox Revenue Calculator');
  console.log('================================\n');
  
  // Get command line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 5) {
    console.log('Usage: node index.js <rpcUrl> <poolAddress> <fromDate> <toDate> <interestFee> --dao-share-bps <bps> [--treasury 0x...] [--revenue-share ...]');
    console.log('');
    console.log('Parameters:');
    console.log('  rpcUrl           - Ethereum RPC endpoint URL');
    console.log('  poolAddress      - Gearbox pool contract address (0x...)');
    console.log('  fromDate         - Start date in YYYY-MM-DD format');
    console.log('  toDate           - End date in YYYY-MM-DD format');
    console.log('  interestFee      - Interest fee in basis points (0-10000)');
    console.log('');
    console.log('Required flag:');
    console.log('  --dao-share-bps  - DAO fee share in basis points (0-10000)');
    console.log('');
    console.log('Optional (general):');
    console.log('  --deploy-date    - Deployment date in YYYY-MM-DD; limits event backfill');
    console.log('  --treasury       - Override treasury address (0x...)');
    console.log('  --debug-share-price - Log share price deltas for each event interval');
    console.log('');
    console.log('Optional (for revenue share):');
    console.log('  --revenue-share  - Enable revenue share mode');
    console.log('  --addresses      - Comma-separated list of addresses (0xABC,0xDEF,...)');
    console.log('  --rev-coeff      - Revenue share coefficient (0-1)');
    console.log('');
    console.log('Examples:');
    console.log('  node index.js https://... 0x123... 2025-09-01 2025-09-30 1000');
    console.log('  node index.js https://... 0x123... 2025-09-01 2025-09-30 1000 --revenue-share --addresses 0xABC,0xDEF --rev-coeff 0.2');
    console.log('');
    console.log('Note: Replace 0x123... with actual Gearbox pool address');
    process.exit(1);
  }
  
  const [rpcUrl, poolAddress, fromDate, toDate, interestFee] = args;
  
  // Parse parameters
  const parsedInterestFee = parseInt(interestFee, 10);
  
  // Parse optional revenue share parameters
  let revenueShareAddresses = null;
  let revenueShareCoeff = null;
  let deployDate = null;
  let debugSharePrice = false;
  let explicitTreasury = null;
  let daoShareOverride = null;
  
  const revenueShareIndex = args.indexOf('--revenue-share');
  if (revenueShareIndex !== -1) {
    const addressesIndex = args.indexOf('--addresses');
    const revCoeffIndex = args.indexOf('--rev-coeff');
    
    if (addressesIndex !== -1 && args[addressesIndex + 1]) {
      revenueShareAddresses = args[addressesIndex + 1].split(',').map(addr => addr.trim().toLowerCase());
    }
    
    if (revCoeffIndex !== -1 && args[revCoeffIndex + 1]) {
      revenueShareCoeff = parseFloat(args[revCoeffIndex + 1]);
    }
    
    if (!revenueShareAddresses || revenueShareAddresses.length === 0 || revenueShareCoeff === null) {
      console.error('❌ Revenue share mode requires --addresses and --rev-coeff');
      process.exit(1);
    }
  }
  
  const deployDateIndex = args.indexOf('--deploy-date');
  if (deployDateIndex !== -1 && args[deployDateIndex + 1]) {
    deployDate = args[deployDateIndex + 1];
  }
  
  if (args.includes('--debug-share-price')) {
    debugSharePrice = true;
  }
  const treasuryIndex = args.indexOf('--treasury');
  if (treasuryIndex !== -1 && args[treasuryIndex + 1]) {
    explicitTreasury = args[treasuryIndex + 1].toLowerCase();
  }
  const daoShareIndex = args.indexOf('--dao-share-bps');
  if (daoShareIndex !== -1 && args[daoShareIndex + 1]) {
    const parsedDaoShare = parseInt(args[daoShareIndex + 1], 10);
    if (Number.isNaN(parsedDaoShare) || parsedDaoShare < 0 || parsedDaoShare > 10000) {
      console.error('❌ --dao-share-bps must be an integer between 0 and 10000.');
      process.exit(1);
    }
    daoShareOverride = parsedDaoShare;
  }
  if (daoShareOverride === null) {
    console.error('❌ --dao-share-bps flag is required (DAO share in basis points)');
    process.exit(1);
  }
  
  // Validate inputs
  const validation = validateInputParameters(poolAddress, fromDate, toDate, parsedInterestFee, deployDate);
  
  if (!validation.isValid) {
    console.error('❌ Input validation failed:');
    validation.errors.forEach(error => console.error(`   - ${error}`));
    process.exit(1);
  }
  
  console.log('📊 Calculation Parameters:');
  console.log(`   RPC URL: ${rpcUrl}`);
  console.log(`   Pool Address: ${poolAddress}`);
  console.log(`   Date Range: ${fromDate} to ${toDate}`);
  console.log(`   Interest Fee: ${parsedInterestFee} basis points (${parsedInterestFee / 100}%)`);
  if (deployDate) {
    console.log(`   Deploy Date: ${deployDate}`);
  }
  if (debugSharePrice) {
    console.log('   Debug Share Price: enabled');
  }
  if (daoShareOverride !== null) {
    console.log(`   DAO Share Override: ${daoShareOverride} bps`);
  }
  if (explicitTreasury) {
    console.log(`   Treasury Override: ${explicitTreasury}`);
  } else {
    console.log('   Treasury: will query pool contract');
  }
  console.log('');
  
  try {
    console.log('⏳ Starting calculation...');
    console.log('   This may take a few minutes depending on the date range and number of events.\n');
    
    const startTime = Date.now();
    const result = await calculateGearboxRevenue(
      rpcUrl,
      poolAddress, 
      fromDate, 
      toDate, 
      parsedInterestFee,
      revenueShareAddresses,
      revenueShareCoeff,
      deployDate,
      { debugSharePrice, treasuryAddressOverride: explicitTreasury, daoShareOverride }
    );
    const endTime = Date.now();
    
    console.log('✅ Calculation completed successfully!');
    console.log(`   Processing time: ${((endTime - startTime) / 1000).toFixed(2)} seconds\n`);
    
    // Display results
    console.log('📈 RESULTS');
    console.log('==========');
    console.log(`Pool: ${result.pool}`);
    console.log(`Date Range: ${result.fromDate} to ${result.toDate}`);
    console.log(`Average TVL: ${result.avgTVL} ${result.underlyingTokenName}`);
    console.log(`Total Revenue (DAO): ${result.totalRevenue} ${result.underlyingTokenName}`);
    console.log('');
    
    if (result.realizedRevenue !== undefined || result.unrealizedRevenue !== undefined) {
      console.log('📦 Revenue Breakdown');
      console.log('--------------------');
      if (result.realizedRevenue !== undefined) {
        console.log(`Realized Revenue (DAO): ${result.realizedRevenue} ${result.underlyingTokenName}`);
      }
      if (result.unrealizedRevenue !== undefined) {
        console.log(`Unrealized Revenue (DAO): ${result.unrealizedRevenue} ${result.underlyingTokenName}`);
      }
      console.log('');
    }
    
    if (result.revenueShare !== undefined) {
      console.log('💰 REVENUE SHARE RESULTS');
      console.log('========================');
      console.log(`Referred Addresses Weighted TVL: ${result.addressesWeightedTVL} ${result.underlyingTokenName}`);
      console.log(`Revenue Share: ${result.revenueShare} ${result.underlyingTokenName}`);
      console.log(`Revenue Share Coefficient: ${result.revenueShareCoeff}`);
      console.log(`Addresses Count: ${result.revenueShareAddresses.length}`);
      console.log('');
    }
    
    // Debug details
    console.log('🔍 Debug Info:');
    console.log(`   Total Revenue Raw: ${result.totalRevenueRaw}`);
    console.log(`   Realized Revenue Raw: ${result.realizedRevenueRaw}`);
    console.log(`   Total Revenue (DAO) Raw: ${result.totalRevenueWithRealizedRaw}`);
    console.log(`   Average TVL Raw: ${result.avgTVLRaw}`);
    if (result.treasuryAddress) {
      console.log(`   Treasury Address Used: ${result.treasuryAddress}`);
    }
    if (typeof result.coverageRatio === 'number') {
      console.log(`   Data Coverage: ${(result.coverageRatio * 100).toFixed(2)}%`);
      console.log(`   Time Using Fallback Data: ${result.fallbackCoverageSeconds ?? 0} seconds`);
      console.log(`   Fallback Intervals: ${result.fallbackIntervals ?? 0}`);
      console.log(`   Negative Share Price Intervals: ${result.negativeSharePriceIntervals}`);
      console.log(`   Anchored Blocks: ${result.actualFromBlock} -> ${result.actualToBlock}`);
      console.log(`   Anchored Period: ${new Date(result.actualFromTimestamp * 1000).toISOString()} -> ${new Date(result.actualToTimestamp * 1000).toISOString()}`);
      console.log(`   Deploy Date Used: ${result.deployDate}`);
      console.log(`   Deploy Block Used: ${result.deployBlock}`);
    }
    
  } catch (error) {
    console.error('❌ Calculation failed:');
    console.error(`   ${formatErrorMessage(error)}`);
    console.error('');
    console.error('💡 Troubleshooting tips:');
    console.error('   - Verify the pool address is correct and deployed');
    console.error('   - Check that the date range is valid');
    console.error('   - Ensure you have internet connection for RPC calls');
    console.error('   - Try with a shorter date range if the calculation times out');
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Run main function
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
