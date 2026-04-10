'use strict';

const Redis = require('ioredis');

// Shared instance
let redisClient = null;

const initializeRedis = async () => {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log(`[Redis] Connecting to ${redisUrl}...`);

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Required by BullMQ
    lazyConnect: true,
    showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
    retryStrategy: (times) => {
      // Limit retries so it doesn't spam the console indefinitely
      if (times > 3) {
        console.warn('[Redis] Max retries reached. Stopping reconnection attempts.');
        return null;
      }
      return Math.min(times * 1000, 3000);
    }
  });

  redisClient.on('error', (err) => {
    // Suppress repeated ECONNREFUSED spam after initial warnings
    if (redisClient.status !== 'reconnecting') {
      console.error('[Redis] Connection error:', err.message || err.code);
    }
  });

  redisClient.on('connect', () => {
    console.log('[Redis] Connected successfully');
  });

  try {
    await redisClient.connect();
    return redisClient;
  } catch (err) {
    console.warn('[Redis] Warning: Core connection failed. Timers will fall back to polling.');
    // Don't throw, allow graceful degradation
    return null;
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }
  return redisClient;
};

module.exports = {
  initializeRedis,
  getRedisClient,
};
