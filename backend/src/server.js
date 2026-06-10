const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./config/db');
const redis = require('./config/redis');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_carbon_key_2026';

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(redis.rateLimiter); // Apply rate limiting to all requests

// Auth Middleware
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

// --------------------------------------------------------------------------
// AUTHENTICATION API
// --------------------------------------------------------------------------

// Register User (Routed to Shard by Username Hash)
app.post('/api/auth/register', async (req, res) => {
  const { username, password, region } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  try {
    // Check if user already exists on the designated shard
    const checkUserSql = 'SELECT * FROM users WHERE username = $1';
    const existingUser = await db.query(username, checkUserSql, [username]);

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Username already taken.' });
    }

    // Hash password and generate User ID
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const userId = crypto.randomUUID();

    const insertUserSql = 'INSERT INTO users (id, username, password, region) VALUES ($1, $2, $3, $4)';
    await db.query(username, insertUserSql, [userId, username, hashedPassword, region || 'Global']);

    // Seed initial leaderboard score of 0 for new user
    await redis.updateLeaderboard(username, 0);

    res.status(201).json({ success: true, message: 'User registered successfully!' });
  } catch (err) {
    console.error('[Registration Error]', err.message);
    res.status(500).json({ success: false, error: 'Database error occurred during registration.' });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  try {
    // Lookup user on the designated shard based on username hash
    const findUserSql = 'SELECT * FROM users WHERE username = $1';
    const result = await db.query(username, findUserSql, [username]);

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid credentials.' });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { id: user.id, username: user.username, region: user.region },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, region: user.region }
    });
  } catch (err) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ success: false, error: 'Database error occurred during login.' });
  }
});

// --------------------------------------------------------------------------
// CARBON FOOTPRINT API
// --------------------------------------------------------------------------

// Submit Carbon Footprint entry
app.post('/api/footprints', authenticateToken, async (req, res) => {
  const { travel, energy, food, waste } = req.body;
  const username = req.user.username;

  if (travel === undefined || energy === undefined || food === undefined || waste === undefined) {
    return res.status(400).json({ success: false, error: 'All footprint scores are required.' });
  }

  try {
    const totalFootprint = parseFloat(travel) + parseFloat(energy) + parseFloat(food) + parseFloat(waste);
    
    // Insert footprint log.
    // National daily average is approx 16kg CO2 per capita.
    // Savings = National Average - User Footprint.
    const baseDailyAvg = 16.0;
    const carbonSaved = Math.max(-50, baseDailyAvg - totalFootprint); // floor score deduction at -50

    const insertSql = `
      INSERT INTO footprints (user_id, travel_score, energy_score, food_score, waste_score, total_footprint)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    await db.query(username, insertSql, [
      req.user.id,
      parseFloat(travel),
      parseFloat(energy),
      parseFloat(food),
      parseFloat(waste),
      totalFootprint
    ]);

    // Update cumulative savings score on global Redis Leaderboard.
    // Fetch user profile footprint records to sum overall savings
    const historySql = 'SELECT total_footprint FROM footprints WHERE user_id = $1';
    const logs = await db.query(username, historySql, [req.user.id]);
    
    const totalSaved = logs.rows.reduce((sum, log) => sum + (baseDailyAvg - log.total_footprint), 0);
    
    // Update Redis Sorted Set
    await redis.updateLeaderboard(username, totalSaved.toFixed(2));

    res.json({
      success: true,
      data: {
        totalFootprint,
        dailySavings: carbonSaved.toFixed(2),
        cumulativeSavings: totalSaved.toFixed(2)
      }
    });
  } catch (err) {
    console.error('[Footprint Entry Error]', err.message);
    res.status(500).json({ success: false, error: 'Database error saving carbon footprint.' });
  }
});

// Get User Footprint History
app.get('/api/footprints/history', authenticateToken, async (req, res) => {
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
    console.error('[Footprint Fetch Error]', err.message);
    res.status(500).json({ success: false, error: 'Database error fetching footprint history.' });
  }
});

// --------------------------------------------------------------------------
// LEADERBOARD API (Pulls directly from Redis)
// --------------------------------------------------------------------------
app.get('/api/leaderboard', async (req, res) => {
  try {
    const topList = await redis.getLeaderboard();
    res.json({ success: true, leaderboard: topList });
  } catch (err) {
    console.error('[Leaderboard Fetch Error]', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard from cache.' });
  }
});

// Start Server and Initialize Database Shards
db.initializeShards().then(() => {
  app.listen(PORT, () => {
    console.log(`[Server] Web service listening on http://localhost:${PORT}`);
  });
});
