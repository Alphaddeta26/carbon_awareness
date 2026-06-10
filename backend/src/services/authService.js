const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const redis = require('../config/redis');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_carbon_key_2026';

// Register User
router.post('/register', async (req, res) => {
  const { username, password, region } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  try {
    const checkUserSql = 'SELECT * FROM users WHERE username = $1';
    // query is routed by username hash ring mapping
    const existingUser = await db.query(username, checkUserSql, [username]);

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Username already taken.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const userId = crypto.randomUUID();

    const insertUserSql = 'INSERT INTO users (id, username, password, region) VALUES ($1, $2, $3, $4)';
    await db.query(username, insertUserSql, [userId, username, hashedPassword, region || 'Global']);

    // Seed initial leaderboard score
    await redis.updateLeaderboard(username, 0);

    res.status(201).json({ success: true, message: 'User registered successfully!' });
  } catch (err) {
    console.error('[Auth Service Registration Error]', err.message);
    res.status(500).json({ success: false, error: 'Database error occurred during registration.' });
  }
});

// Login User
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  try {
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
    console.error('[Auth Service Login Error]', err.message);
    res.status(500).json({ success: false, error: 'Database error occurred during login.' });
  }
});

module.exports = router;
