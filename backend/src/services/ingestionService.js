const express = require('express');
const jwt = require('jsonwebtoken');
const broker = require('../config/broker');
const db = require('../config/db');
const redis = require('../config/redis');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_carbon_key_2026';
const BASE_DAILY_AVG = 16.0;

// JWT Token Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
}


// Ingest Daily Footprint Entry (Queue-based Asynchronous Write-Behind)
router.post('/footprints', authenticateToken, async (req, res) => {
  const { travel, energy, food, waste } = req.body;

  if (travel === undefined || energy === undefined || food === undefined || waste === undefined) {
    return res.status(400).json({ success: false, error: 'All footprint scores are required.' });
  }

  // Check if running in synchronous mode (Vercel Serverless or Monolith)
  const isSyncMode = process.env.VERCEL || process.env.SERVICE_TYPE === 'monolith' || !process.env.SERVICE_TYPE;

  if (isSyncMode) {
    try {
      const totalFootprint = parseFloat(travel) + parseFloat(energy) + parseFloat(food) + parseFloat(waste);
      const carbonSaved = BASE_DAILY_AVG - totalFootprint;

      const insertSql = `
        INSERT INTO footprints (user_id, travel_score, energy_score, food_score, waste_score, total_footprint)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      await db.query(req.user.username, insertSql, [
        req.user.id,
        parseFloat(travel),
        parseFloat(energy),
        parseFloat(food),
        parseFloat(waste),
        totalFootprint
      ]);

      const historySql = 'SELECT total_footprint FROM footprints WHERE user_id = $1';
      const logsResult = await db.query(req.user.username, historySql, [req.user.id]);
      const totalSaved = logsResult.rows.reduce((sum, log) => sum + (BASE_DAILY_AVG - log.total_footprint), 0);

      await redis.updateLeaderboard(req.user.username, totalSaved.toFixed(2));

      return res.json({
        success: true,
        data: {
          totalFootprint,
          dailySavings: carbonSaved.toFixed(2),
          cumulativeSavings: totalSaved.toFixed(2)
        }
      });
    } catch (err) {
      console.error('[Ingestion Sync Write Error]', err.message);
      return res.status(500).json({ success: false, error: 'Database error saving carbon footprint.' });
    }
  }

  // Asynchronous message queue write-behind (Microservice configuration)
  const jobPayload = {
    user: req.user,
    scores: {
      travel: parseFloat(travel),
      energy: parseFloat(energy),
      food: parseFloat(food),
      waste: parseFloat(waste)
    },
    timestamp: Date.now()
  };

  try {
    const queued = await broker.publishJob(jobPayload);
    
    if (!queued) {
      return res.status(500).json({ success: false, error: 'Queue service temporarily unavailable.' });
    }

    res.status(202).json({
      success: true,
      message: 'Footprint entry accepted for queue processing.',
      status: 'pending'
    });
  } catch (err) {
    console.error('[Ingestion Service Error]', err.message);
    res.status(500).json({ success: false, error: 'Internal server error queueing footprint.' });
  }
});

// Fetch historical footprint records from sharded database (Read-through)
router.get('/footprints/history', authenticateToken, async (req, res) => {
  const username = req.user.username;

  try {
    const historySql = `
      SELECT travel_score, energy_score, food_score, waste_score, total_footprint, created_at
      FROM footprints
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `;
    const result = await db.query(username, historySql, [req.user.id]);
    res.json({ success: true, history: result.rows });
  } catch (err) {
    console.error('[Ingestion History Fetch Error]', err.message);
    res.status(500).json({ success: false, error: 'Database error fetching footprint history.' });
  }
});

module.exports = router;
