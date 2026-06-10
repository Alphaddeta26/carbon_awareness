const express = require('express');
const jwt = require('jsonwebtoken');
const broker = require('../config/broker');
const db = require('../config/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_carbon_key_2026';

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
    // Publish task to event broker list
    const queued = await broker.publishJob(jobPayload);
    
    if (!queued) {
      return res.status(500).json({ success: false, error: 'Queue service temporarily unavailable.' });
    }

    // Instantly return 202 Accepted status for rapid response
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
