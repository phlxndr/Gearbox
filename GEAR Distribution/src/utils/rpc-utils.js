/**
 * Utilities for resilient RPC interactions (rate limit handling, retries, etc.)
 */

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Sleep helper
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize error into lowercase string for pattern checks
 * @param {unknown} error
 * @returns {string}
 */
function normaliseErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error.toLowerCase();
  const message = error.shortMessage || error.message || error.code || '';
  return (message || '').toString().toLowerCase();
}

const RETRYABLE_ERROR_CODES = new Set([
  'etimedout',
  'ecconnreset',
  'econnrefused',
  'eaddrinuse',
  'enotfound',
  'eai_again'
]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  '429',
  'rate limit',
  'too many requests',
  'limit exceeded',
  'temporarily unavailable',
  'timeout',
  'timed out',
  'try again later',
  'gateway timeout',
  'server error',
  'socket hang up'
];

const BLOCK_RANGE_LIMIT_FRAGMENTS = [
  'block range',
  'too high',
  'too wide',
  'max range',
  'query returned more than',
  'exceeds the maximum',
  'is greater than the limit'
];

const HISTORICAL_DATA_FRAGMENTS = [
  'returned no data',
  'header not found',
  'missing trie node',
  'unknown block',
  'no state available',
  'does not have the function',
  'not an archive node',
  'only supports latest',
  'state is not available'
];

/**
 * Determine if error is likely transient/rate-limit and worth retrying
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetriableError(error) {
  const message = normaliseErrorMessage(error);
  if (!message) return false;
  if (RETRYABLE_MESSAGE_FRAGMENTS.some(fragment => message.includes(fragment))) {
    return true;
  }
  const code = (error && typeof error === 'object' && 'code' in error) ? String(error.code || '').toLowerCase() : '';
  return RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Detect RPC block range limit error
 * @param {unknown} error
 * @returns {boolean}
 */
export function isBlockRangeLimitError(error) {
  const message = normaliseErrorMessage(error);
  if (!message) return false;
  return BLOCK_RANGE_LIMIT_FRAGMENTS.some(fragment => message.includes(fragment));
}

/**
 * Detect missing historical state (non-archive RPC)
 * @param {unknown} error
 * @returns {boolean}
 */
export function isHistoricalDataUnavailable(error) {
  const message = normaliseErrorMessage(error);
  if (!message) return false;
  return HISTORICAL_DATA_FRAGMENTS.some(fragment => message.includes(fragment));
}

// ============================================================================
// RETRY WRAPPER
// ============================================================================

/**
 * Execute fn with retry/backoff
 * @template T
 * @param {() => Promise<T>} fn
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.initialDelayMs=250]
 * @param {number} [options.backoffMultiplier=2]
 * @param {(error: unknown, attempt: number) => boolean} [options.shouldRetry]
 * @param {(context: { error: unknown, attempt: number, delayMs: number }) => void | Promise<void>} [options.onRetry]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelayMs = 250,
    backoffMultiplier = 2,
    shouldRetry = isRetriableError,
    onRetry = null
  } = options;

  let attempt = 0;
  let delayMs = Math.max(0, initialDelayMs);

  // First attempt happens immediately (attempt number 0)
  // Subsequent attempts respect delay/backoff
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || (shouldRetry && !shouldRetry(error, attempt))) {
        throw error;
      }

      attempt += 1;

      if (onRetry) {
        try {
          await onRetry({ error, attempt, delayMs });
        } catch {
          // Ignore logging handler errors
        }
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
      delayMs = Math.ceil(delayMs * backoffMultiplier);
    }
  }
}
