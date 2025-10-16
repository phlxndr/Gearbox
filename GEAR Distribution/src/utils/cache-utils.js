/**
 * Cache utilities
 */

// Simple in-memory cache for blocks and pool states
const blockCache = new Map();
const poolStateCache = new Map();

// Cache TTL (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Clear caches (useful for memory management)
 */
export function clearCaches() {
  blockCache.clear();
  poolStateCache.clear();
  console.log('Caches cleared');
}

/**
 * Get cache instances
 * @returns {Object} Cache instances and TTL
 */
export function getCaches() {
  return {
    blockCache,
    poolStateCache,
    CACHE_TTL
  };
}
