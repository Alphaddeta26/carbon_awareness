const { Pool } = require('pg');
const ConsistentHashRing = require('./consistent_hashing');
require('dotenv').config();

let useMock = false;
let shardMap = {};
let shards = [];
let ring;

// Mock In-Memory DB Store
const mockDb = {
  users: [],
  footprints: []
};

const dbShard1Url = process.env.DB_SHARD_1_URL;
const dbShard2Url = process.env.DB_SHARD_2_URL;

if (dbShard1Url && dbShard2Url) {
  const poolShard1 = new Pool({ connectionString: dbShard1Url });
  const poolShard2 = new Pool({ connectionString: dbShard2Url });

  shardMap = {
    'shard-1': poolShard1,
    'shard-2': poolShard2
  };

  shards = [poolShard1, poolShard2];
  ring = new ConsistentHashRing(['shard-1', 'shard-2'], 100);

  // Connection check
  poolShard1.on('error', (err) => {
    console.error('[DB Shard 1 Error]', err.message);
    useMock = true;
  });
  poolShard2.on('error', (err) => {
    console.error('[DB Shard 2 Error]', err.message);
    useMock = true;
  });
} else {
  console.log('[DB Sharder] No DB_SHARD_1_URL or DB_SHARD_2_URL environment variables set. Running in-memory mock database mode.');
  useMock = true;
}

/**
 * Mock SQL Query Engine executing query templates against in-memory lists.
 */
function queryMock(text, params) {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  console.log(`[DB Mock Engine] Executing: ${normalizedText}`);

  // Query 1: SELECT * FROM users WHERE username = $1
  if (normalizedText.includes('SELECT * FROM users WHERE username =')) {
    const username = params[0];
    const match = mockDb.users.filter(u => u.username === username);
    return { rows: match };
  }

  // Query 2: INSERT INTO users (id, username, password, region) VALUES ($1, $2, $3, $4)
  if (normalizedText.startsWith('INSERT INTO users')) {
    const newUser = {
      id: params[0],
      username: params[1],
      password: params[2],
      region: params[3] || 'Global',
      created_at: new Date()
    };
    mockDb.users.push(newUser);
    return { rows: [] };
  }

  // Query 3: INSERT INTO footprints (user_id, travel_score, energy_score, food_score, waste_score, total_footprint)
  if (normalizedText.startsWith('INSERT INTO footprints')) {
    const newLog = {
      id: mockDb.footprints.length + 1,
      user_id: params[0],
      travel_score: parseFloat(params[1]),
      energy_score: parseFloat(params[2]),
      food_score: parseFloat(params[3]),
      waste_score: parseFloat(params[4]),
      total_footprint: parseFloat(params[5]),
      created_at: new Date()
    };
    mockDb.footprints.push(newLog);
    return { rows: [] };
  }

  // Query 4 & 5: SELECT history/total_footprints FROM footprints
  if (normalizedText.includes('FROM footprints WHERE user_id =')) {
    const userId = params[0];
    const matchLogs = mockDb.footprints
      .filter(f => f.user_id === userId)
      .sort((a, b) => b.created_at - a.created_at); // Sort DESC
    
    // Check if limit query
    if (normalizedText.includes('LIMIT 20')) {
      return { rows: matchLogs.slice(0, 20) };
    }
    return { rows: matchLogs };
  }

  return { rows: [] };
}

/**
 * Resolves database pool for user key.
 */
function getTargetPool(key) {
  if (useMock) return null;
  const targetNodeName = ring.getNode(key) || 'shard-1';
  return shardMap[targetNodeName];
}

/**
 * Route and execute query on SQL Shards, or fall back to Mock Engine.
 */
async function queryRouted(routingKey, text, params) {
  if (useMock) {
    return queryMock(text, params);
  }

  const targetPool = getTargetPool(routingKey);
  const targetNodeName = ring.getNode(routingKey) || 'shard-1';
  
  console.log(`[DB Sharder] Consistent Ring routed key "${routingKey}" to "${targetNodeName}"`);
  return targetPool.query(text, params);
}

/**
 * Initializes SQL sharded schemas.
 */
async function initializeShards() {
  if (useMock) {
    console.log('[DB Sharder] In-memory sharded tables ready.');
    return;
  }

  const tableInitQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      region VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS footprints (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      travel_score FLOAT DEFAULT 0,
      energy_score FLOAT DEFAULT 0,
      food_score FLOAT DEFAULT 0,
      waste_score FLOAT DEFAULT 0,
      total_footprint FLOAT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const keys = Object.keys(shardMap);
  for (let i = 0; i < keys.length; i++) {
    const nodeName = keys[i];
    try {
      await shardMap[nodeName].query(tableInitQuery);
      console.log(`[DB Sharder] Shard "${nodeName}" initialized tables successfully.`);
    } catch (err) {
      console.error(`[DB Sharder Error] Failed to initialize Shard "${nodeName}":`, err.message);
    }
  }
}

module.exports = {
  query: queryRouted,
  initializeShards,
  getTargetPool,
  ring,
  shards
};
