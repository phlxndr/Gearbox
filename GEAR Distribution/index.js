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
  
  if (args.length < 4) {
    console.log('Usage: node index.js <rpcUrl> <poolAddress> <fromDate> <toDate> <interestFee>');
    console.log('');
    console.log('Parameters:');
    console.log('  rpcUrl       - Ethereum RPC endpoint URL');
    console.log('  poolAddress  - Gearbox pool contract address (0x...)');
    console.log('  fromDate     - Start date in YYYY-MM-DD format');
    console.log('  toDate       - End date in YYYY-MM-DD format');
    console.log('  interestFee  - Interest fee in basis points (0-10000)');
    console.log('');
    console.log('Examples:');
    console.log('  node index.js https://lb.drpc.live/ethereum/... 0x123... 2025-09-01 2025-09-30 1000');
    console.log('');
    console.log('Note: Replace 0x123... with actual Gearbox pool address');
    process.exit(1);
  }
  
  const [rpcUrl, poolAddress, fromDate, toDate, interestFee] = args;
  
  // Parse parameters
  const parsedInterestFee = parseInt(interestFee, 10);
  
  // Validate inputs
  const validation = validateInputParameters(poolAddress, fromDate, toDate, parsedInterestFee);
  
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
      parsedInterestFee
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
    console.log(`Generated Revenue for DAO: ${result.generatedRevenue} ${result.underlyingTokenName}`);
    console.log('');
    
    // Underlying token info
    console.log(`   Underlying Token: ${result.underlyingToken} (${result.underlyingTokenName})`);
    console.log(`   Token Decimals: ${result.tokenDecimals}`);
    console.log('');
    
    // Raw values for debugging
    console.log('🔍 Raw Values (for debugging):');
    console.log(`   Total Revenue Raw: ${result.totalRevenueRaw}`);
    console.log(`   Average TVL Raw: ${result.avgTVLRaw}`);
    
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
