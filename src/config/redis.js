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
  });

  redisClient.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
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
