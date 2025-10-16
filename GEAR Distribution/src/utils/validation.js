/**
 * Validation utilities for Gearbox Revenue Calculator
 */

// ============================================================================
// BASIC VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate Ethereum address format
 * @param {string} address - Address to validate
 * @returns {boolean} True if valid Ethereum address
 */
export function isValidEthereumAddress(address) {
  if (!address || typeof address !== 'string') {
    return false;
  }
  
  // Basic Ethereum address format check
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return ethAddressRegex.test(address);
}

/**
 * Validate date format (YYYY-MM-DD)
 * @param {string} dateString - Date string to validate
 * @returns {boolean} True if valid date format
 */
export function isValidDateFormat(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return false;
  }
  
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return false;
  }
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date) && date.toISOString().slice(0, 10) === dateString;
}

/**
 * Validate date range
 * @param {string} fromDate - Start date
 * @param {string} toDate - End date
 * @returns {boolean} True if valid date range
 */
export function isValidDateRange(fromDate, toDate) {
  if (!isValidDateFormat(fromDate) || !isValidDateFormat(toDate)) {
    return false;
  }
  
  const from = new Date(fromDate);
  const to = new Date(toDate);
  
  return from <= to;
}


/**
 * Validate percentage (basis points)
 * @param {number} percentage - Percentage in basis points
 * @returns {boolean} True if valid percentage
 */
export function isValidPercentage(percentage) {
  return typeof percentage === 'number' && percentage >= 0 && percentage <= 10000;
}

// ============================================================================
// COMPLEX VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate all input parameters for calculateGearboxRevenue
 * @param {string} poolAddress - Pool contract address
 * @param {string} fromDate - Start date
 * @param {string} toDate - End date
 * @param {number} interestFee - Interest fee in basis points
 * @returns {Object} Validation result with isValid and errors
 */
export function validateInputParameters(poolAddress, fromDate, toDate, interestFee) {
  const errors = [];
  
  // Validate pool address
  if (!isValidEthereumAddress(poolAddress)) {
    errors.push('Invalid pool address format');
  }
  
  // Validate dates
  if (!isValidDateFormat(fromDate)) {
    errors.push('Invalid fromDate format. Expected YYYY-MM-DD');
  }
  
  if (!isValidDateFormat(toDate)) {
    errors.push('Invalid toDate format. Expected YYYY-MM-DD');
  }
  
  // Validate date range
  if (isValidDateFormat(fromDate) && isValidDateFormat(toDate) && !isValidDateRange(fromDate, toDate)) {
    errors.push('fromDate must be before or equal to toDate');
  }
  
  // Validate interest fee
  if (!isValidPercentage(interestFee)) {
    errors.push('interestFee must be a number between 0 and 10000 (basis points)');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize and format input parameters
 * @param {string} poolAddress - Pool contract address
 * @param {string} fromDate - Start date
 * @param {string} toDate - End date
 * @param {number} interestFee - Interest fee in basis points
 * @returns {Object} Sanitized parameters
 */
export function sanitizeInputParameters(poolAddress, fromDate, toDate, interestFee) {
  return {
    poolAddress: poolAddress?.toLowerCase(),
    fromDate: fromDate?.trim(),
    toDate: toDate?.trim(),
    interestFee: Number(interestFee)
  };
}

// ============================================================================
// ERROR HANDLING UTILITIES
// ============================================================================

/**
 * Format error message for user display
 * @param {Error} error - Error object
 * @returns {string} Formatted error message
 */
export function formatErrorMessage(error) {
  if (error.message.includes('execution reverted')) {
    return 'Contract call failed. The pool address might be invalid or the contract might not be deployed.';
  }
  
  if (error.message.includes('network')) {
    return 'Network error. Please check your internet connection and RPC endpoint.';
  }
  
  if (error.message.includes('block')) {
    return 'Block not found. The specified date range might be too old or in the future.';
  }
  
  if (error.message.includes('price')) {
    return 'Price oracle error. Unable to fetch token price data.';
  }
  
  return error.message || 'Unknown error occurred';
}

