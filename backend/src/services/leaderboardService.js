const express = require('express');
const redis = require('../config/redis');

const router = express.Router();

// Fetch rankings directly from high-speed Redis sorted sets
router.get('/leaderboard', async (req, res) => {
  try {
    const list = await redis.getLeaderboard();
    res.json({ success: true, leaderboard: list });
  } catch (err) {
    console.error('[Leaderboard Service Error]', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard from cache.' });
  }
});

module.exports = router;
