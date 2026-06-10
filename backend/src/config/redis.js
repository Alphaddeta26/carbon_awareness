const { createClient } = require('redis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL;
let redisClient;
let useMock = false;

// Mock In-Memory Store
const mockData = {
  lists: {},       // for rate limiting lists and queues
  leaderboard: []  // for ZSET leaderboard [{ value: username, score: number }]
};

const listeners = {};

if (redisUrl) {
  redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (err) => {
    console.warn('[Redis Client Warning] Connection failed, switching to in-memory mock.', err.message);
    useMock = true;
  });
  
  (async () => {
    try {
      await redisClient.connect();
    } catch (err) {
      console.warn('[Redis Connection Warning] Could not connect. Using local in-memory fallback.');
      useMock = true;
    }
  })();
} else {
  console.log('[Redis Config] No REDIS_URL environment variable set. Running in-memory mock mode.');
  useMock = true;
}

// --------------------------------------------------------------------------
// MOCK REDIS FUNCTIONS
// --------------------------------------------------------------------------
const mockRedis = {
  // Sliding window list logic
  multi: () => {
    const operations = [];
    return {
      lPush: (key, val) => {
        operations.push(() => {
          if (!mockData.lists[key]) mockData.lists[key] = [];
          mockData.lists[key].unshift(val);
        });
      },
      lTrim: (key, start, end) => {
        operations.push(() => {
          if (mockData.lists[key]) {
            mockData.lists[key] = mockData.lists[key].slice(start, end + 1);
          }
        });
      },
      expire: () => {
        // Mock expire does nothing in memory
      },
      exec: async () => {
        operations.forEach(op => op());
        return [1, 'OK'];
      }
    };
  },
  lRange: async (key, start, end) => {
    const list = mockData.lists[key] || [];
    return end === -1 ? list.slice(start) : list.slice(start, end + 1);
  },
  // Queue Push & Pop Mocks
  rPush: async (key, val) => {
    if (!mockData.lists[key]) mockData.lists[key] = [];
    mockData.lists[key].push(val);
    
    // Trigger any waiting blPop listener
    if (listeners[key] && listeners[key].length > 0) {
      const cb = listeners[key].shift();
      cb();
    }
    return 1;
  },
  blPop: async (key, timeout) => {
    if (mockData.lists[key] && mockData.lists[key].length > 0) {
      const element = mockData.lists[key].shift();
      return { key, element };
    }
    
    // Return promise that resolves once a value is pushed via rPush
    return new Promise((resolve) => {
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(() => {
        const element = mockData.lists[key].shift();
        resolve({ key, element });
      });
    });
  },
  // Sorted Set Leaderboard logic
  zAdd: async (key, item) => {
    const idx = mockData.leaderboard.findIndex(x => x.value === item.value);
    if (idx !== -1) {
      mockData.leaderboard[idx].score = item.score;
    } else {
      mockData.leaderboard.push({ value: item.value, score: item.score });
    }
    mockData.leaderboard.sort((a, b) => b.score - a.score);
  },
  zRangeWithScores: async (key, start, end, options) => {
    const list = [...mockData.leaderboard];
    const sliced = list.slice(start, end + 1);
    return sliced;
  }
};

/**
 * Sliding Window Rate Limiting Middleware.
 * Allows max 50 requests per 60 seconds per IP.
 */
async function rateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const key = `rate_limit:${ip}`;
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 50;

  try {
    const client = useMock ? mockRedis : redisClient;
    const minTimestamp = now - windowMs;

    const multi = client.multi();
    multi.lPush(key, now.toString());
    multi.lTrim(key, 0, maxRequests + 5);
    await multi.exec();

    const timestamps = await client.lRange(key, 0, -1);
    const validTimestamps = timestamps.filter(t => parseInt(t) > minTimestamp);

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
    next();
  }
}

/**
 * Adds or updates user reduction score on leaderboard.
 */
async function updateLeaderboardScore(username, carbonSaved) {
  try {
    const client = useMock ? mockRedis : redisClient;
    await client.zAdd('leaderboard:global', {
      score: parseFloat(carbonSaved),
      value: username
    });
    console.log(`[Leaderboard] Updated score for "${username}" to ${carbonSaved} kg`);
  } catch (err) {
    console.error('[Leaderboard Error] Failed to update score:', err.message);
  }
}

/**
 * Fetches top 10 carbon reducing champions.
 */
async function getTopLeaderboard() {
  try {
    const client = useMock ? mockRedis : redisClient;
    const list = await client.zRangeWithScores('leaderboard:global', 0, 9, {
      REV: true
    });
    return list.map(item => ({
      username: item.value,
      score: item.score
    }));
  } catch (err) {
    console.error('[Leaderboard Error] Failed to fetch leaderboard:', err.message);
    return [];
  }
}

module.exports = {
  redisClient,
  rateLimiter,
  updateLeaderboard: updateLeaderboardScore,
  getLeaderboard: getTopLeaderboard
};
