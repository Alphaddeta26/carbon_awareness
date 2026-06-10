const { Pool } = require('pg');
const ConsistentHashRing = require('./consistent_hashing');
require('dotenv').config();

// Initialize connection pools for both database shards
const poolShard1 = new Pool({
  connectionString: process.env.DB_SHARD_1_URL || 'postgres://postgres:postgrespass@localhost:5433/carbon_shard1'
});

const poolShard2 = new Pool({
  connectionString: process.env.DB_SHARD_2_URL || 'postgres://postgres:postgrespass@localhost:5434/carbon_shard2'
});

const shardMap = {
  'shard-1': poolShard1,
  'shard-2': poolShard2
};

const shards = [poolShard1, poolShard2];

// Instantiate consistent hash ring with the database shard identifiers
const ring = new ConsistentHashRing(['shard-1', 'shard-2'], 100);

/**
 * Routes a User ID (or username) to a physical database pool using the Consistent Hash Ring.
 * @param {string} key - Routing key (username or user UUID)
 * @returns {Pool} Target PostgreSQL pool
 */
function getTargetPool(key) {
  const targetNodeName = ring.getNode(key) || 'shard-1';
  return shardMap[targetNodeName];
}

/**
 * Executes a query on the correct shard resolved by the Consistent Hash Ring.
 * @param {string} routingKey - Key used to route the query
 * @param {string} text - SQL query template
 * @param {Array} params - SQL query arguments
 */
async function queryRouted(routingKey, text, params) {
  const targetPool = getTargetPool(routingKey);
  const targetNodeName = ring.getNode(routingKey) || 'shard-1';
  
  console.log(`[DB Sharder] Consistent Ring routed key "${routingKey}" to "${targetNodeName}"`);
  return targetPool.query(text, params);
}

/**
 * Utility to run migrations/initialize tables on all database shards.
 */
async function initializeShards() {
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
