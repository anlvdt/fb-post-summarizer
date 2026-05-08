// FeedWriter — Utility functions and helpers
// https://github.com/anlvdt/fb-post-summarizer
// Author: Le An (anlvdt)

/**
 * LRU Cache implementation with size limit
 */
class LRUCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    // Delete if exists (to reinsert at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // Evict oldest if at capacity
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  keys() {
    return this.cache.keys();
  }

  get size() {
    return this.cache.size;
  }

  // Delete all keys matching a prefix
  deletePrefix(prefix) {
    const keysToDelete = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
    return keysToDelete.length;
  }
}

/**
 * Debounce function with configurable delay
 */
function debounce(func, delay) {
  let timeoutId = null;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      func.apply(this, args);
    }, delay);
  };
}

/**
 * Throttle function with configurable delay
 */
function throttle(func, delay) {
  let timeoutId = null;
  let lastRan = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastRan >= delay) {
      func.apply(this, args);
      lastRan = now;
    } else {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func.apply(this, args);
        lastRan = Date.now();
        timeoutId = null;
      }, delay - (now - lastRan));
    }
  };
}

/**
 * Capitalize first letter of string
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Efficient HTML escape without creating DOM elements
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Create a fetch request with timeout
 */
function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutId));
}

/**
 * Retry function with exponential backoff
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Batch multiple storage operations
 */
class StorageBatcher {
  constructor(delay = 500) {
    this.delay = delay;
    this.pending = {};
    this.timeoutId = null;
    this.flushing = false;
  }

  set(key, value) {
    this.pending[key] = value;
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => this.flush(), this.delay);
  }

  async flush() {
    if (this.flushing || Object.keys(this.pending).length === 0) return;
    this.flushing = true;
    const toSave = { ...this.pending };
    this.pending = {};
    this.timeoutId = null;

    try {
      await chrome.storage.local.set(toSave);
    } catch (error) {
      console.error('Storage batch write failed:', error);
      Object.assign(this.pending, toSave);
    } finally {
      this.flushing = false;
    }
  }
}

/**
 * Safe storage get with error handling
 */
async function safeStorageGet(storage, keys, defaultValues = {}) {
  try {
    const data = await storage.get(keys);
    return { ...defaultValues, ...data };
  } catch (error) {
    console.error('Storage get failed:', error);
    return defaultValues;
  }
}

/**
 * Safe storage set with error handling
 */
async function safeStorageSet(storage, data) {
  try {
    await storage.set(data);
    return { success: true };
  } catch (error) {
    console.error('Storage set failed:', error);
    return { success: false, error };
  }
}

/**
 * Check if extension context is valid
 */
function isContextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch (e) {
    return false;
  }
}

/**
 * Cleanup event listeners helper
 */
class EventListenerManager {
  constructor() {
    this.listeners = [];
  }

  add(element, event, handler, options) {
    element.addEventListener(event, handler, options);
    this.listeners.push({ element, event, handler, options });
  }

  removeAll() {
    this.listeners.forEach(({ element, event, handler, options }) => {
      element.removeEventListener(event, handler, options);
    });
    this.listeners = [];
  }

  remove(element, event) {
    this.listeners = this.listeners.filter(listener => {
      if (listener.element === element && listener.event === event) {
        element.removeEventListener(event, listener.handler, listener.options);
        return false;
      }
      return true;
    });
  }
}

/**
 * Download file helper
 */
function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke after a short delay to ensure download starts
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Format date consistently
 */
function formatDate(date) {
  return new Date(date).toLocaleString('vi');
}

/**
 * Truncate text with ellipsis
 */
function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Simple logger with levels
 */
class Logger {
  constructor(level = 'info') {
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
    this.level = this.levels[level] || 1;
  }

  debug(message, ...args) {
    if (this.level <= 0) console.debug(`[DEBUG] ${message}`, ...args);
  }

  info(message, ...args) {
    if (this.level <= 1) console.info(`[INFO] ${message}`, ...args);
  }

  warn(message, ...args) {
    if (this.level <= 2) console.warn(`[WARN] ${message}`, ...args);
  }

  error(message, ...args) {
    if (this.level <= 3) console.error(`[ERROR] ${message}`, ...args);
  }
}

/**
 * Feature flags for conditional features
 */
const featureFlags = {
  enableLogging: true,
  enableCache: true,
  enableBatchStorage: true,
  enableEventDelegation: true,
  enableMutationObserver: true,
  enableIntersectionObserver: false, // Experimental
  testMode: false, // Enable test/debug features
};

const logger = new Logger(featureFlags.testMode ? 'debug' : 'info');

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LRUCache,
    debounce,
    throttle,
    capitalize,
    escapeHtml,
    fetchWithTimeout,
    retryWithBackoff,
    StorageBatcher,
    safeStorageGet,
    safeStorageSet,
    isContextValid,
    EventListenerManager,
    downloadFile,
    formatDate,
    truncate,
    Logger,
    logger,
    featureFlags
  };
}
