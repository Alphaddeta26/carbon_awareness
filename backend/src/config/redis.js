const { createClient } = require('redis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: redisUrl });

redisClient.on('error', (err) => console.error('[Redis Client Error]', err));
redisClient.on('connect', () => console.log('[Redis Client] Connected to Redis server.'));

(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('[Redis Connection Error] Failed to connect:', err.message);
  }
})();

/**
 * Sliding Window Rate Limiting Middleware using Redis lists.
 * Allows max 50 requests per 60 seconds per IP address.
 */
async function rateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const key = `rate_limit:${ip}`;
  const now = Date.now();
  const windowMs = 60000; // 60 seconds
  const maxRequests = 50;  // Limit

  try {
    // 1. Remove timestamps older than window limit
    const minTimestamp = now - windowMs;
    // We fetch current list, filter it, and save it back using multi/transaction
    const multi = redisClient.multi();
    multi.lPush(key, now.toString());
    multi.lTrim(key, 0, maxRequests + 5); // Keep list size under control
    multi.expire(key, 65); // Expire key after window
    const [pushResult, trimResult] = await multi.exec();

    // 2. Fetch list values to calculate hits within sliding window
    const timestamps = await redisClient.lRange(key, 0, -1);
    const validTimestamps = timestamps.filter(t => parseInt(t) > minTimestamp);

    // If hits within window exceed max limit, return HTTP 429
    if (validTimestamps.length > maxRequests) {
      console.warn(`[Rate Limiter] Rate limit exceeded for IP: ${ip}`);
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again after a minute.'
      });
    }

    next();
  } catch (err) {
    console.error('[Rate Limiter Error]', err.message);
    // On cache failure, allow requests to fail-open so app isn't bricked
    next();
  }
}

/**
 * Adds or updates a user's emission reduction savings score on the global leaderboard.
 * @param {string} username - User account name
 * @param {number} carbonSaved - Net kg CO2 saved
 */
async function updateLeaderboardScore(username, carbonSaved) {
  try {
    // Sorted set (ZADD) adds/updates the score for member username
    await redisClient.zAdd('leaderboard:global', {
      score: parseFloat(carbonSaved),
      value: username
    });
    console.log(`[Redis Leaderboard] Updated score for "${username}" to ${carbonSaved} kg`);
  } catch (err) {
    console.error('[Redis Leaderboard Error] Failed to update score:', err.message);
  }
}

/**
 * Fetches top 10 carbon reducing champions from Redis Sorted Set.
 * @returns {Promise<Array>} List of user objects with username and points
 */
async function getTopLeaderboard() {
  try {
    const list = await redisClient.zRangeWithScores('leaderboard:global', 0, 9, {
      REV: true
    });
    return list.map(item => ({
      username: item.value,
      score: item.score
    }));
  } catch (err) {
    console.error('[Redis Leaderboard Error] Failed to fetch leaderboard:', err.message);
    return [];
  }
}

module.exports = {
  redisClient,
  rateLimiter,
  updateLeaderboard: updateLeaderboardScore,
  getLeaderboard: getTopLeaderboard
};
