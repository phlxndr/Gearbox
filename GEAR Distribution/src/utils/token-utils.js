/**
 * Token utilities
 */

// ============================================================================
// IMPORTS
// ============================================================================

import { ERC20_ABI } from '../config.js';

// ============================================================================
// TOKEN NAME UTILITIES
// ============================================================================

// ERC20 ABI for getting token name and symbol
const ERC20_NAME_ABI = [
  {
    "inputs": [],
    "name": "name",
    "outputs": [{"name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol", 
    "outputs": [{"name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  }
];

/**
 * Get token name by address (on-chain)
 * @param {string} tokenAddress - Token contract address
 * @param {Object} client - Viem client
 * @returns {Promise<string>} Token name or address if not found
 */
export async function getTokenName(tokenAddress, client) {
  try {
    const name = await client.readContract({
      address: tokenAddress,
      abi: ERC20_NAME_ABI,
      functionName: 'name'
    });
    return name;
  } catch (error) {
    // Fallback to symbol if name fails
    try {
      const symbol = await client.readContract({
        address: tokenAddress,
        abi: ERC20_NAME_ABI,
        functionName: 'symbol'
      });
      return symbol;
    } catch (error2) {
      // Final fallback to address
      return tokenAddress;
    }
  }
}

// ============================================================================
// TOKEN DECIMALS UTILITIES
// ============================================================================

/**
 * Get token decimals
 * @param {string} tokenAddress - Token contract address
 * @param {Object} client - Viem client
 * @returns {Promise<number>} Token decimals
 */
export async function getTokenDecimals(tokenAddress, client) {
  return await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals'
  });
}
