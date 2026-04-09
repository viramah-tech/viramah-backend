'use strict';
const { getRedisClient } = require('../config/redis');

const IDEMPOTENCY_TTL = 86400; // 24 hours

const idempotency = async (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!key) return next();
  if (!req.user?._id) return next();

  const redisKey = `idempotency:${req.user._id}:${key}`;

  try {
    const redis = getRedisClient();
    const cached = await redis.get(redisKey);
    if (cached) {
      const { status, body } = JSON.parse(cached);
      return res.status(status).json(body);
    }

    // Intercept response to cache it
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 500) {
        redis.set(redisKey, JSON.stringify({ status: res.statusCode, body }), 'EX', IDEMPOTENCY_TTL)
          .catch((e) => console.warn('[idempotency] cache write failed', e.message));
      }
      return originalJson(body);
    };

    next();
  } catch (e) {
    console.warn('[idempotency] Redis unavailable, skipping:', e.message);
    next();
  }
};

module.exports = idempotency;
