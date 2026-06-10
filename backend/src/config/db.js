const { Pool } = require('pg');
require('dotenv').config();

// Initialize connection pools for both database shards
const poolShard1 = new Pool({
  connectionString: process.env.DB_SHARD_1_URL || 'postgres://postgres:postgrespass@localhost:5433/carbon_shard1'
});

const poolShard2 = new Pool({
  connectionString: process.env.DB_SHARD_2_URL || 'postgres://postgres:postgrespass@localhost:5434/carbon_shard2'
});

const shards = [poolShard1, poolShard2];

/**
 * Basic hashing function to route UUIDs/User IDs to specific shards (Consistent Modulo Hashing)
 * @param {string} userId - UUID or identifier of the user
 * @returns {number} Shard index (0 or 1)
 */
function getShardIndex(userId) {
  if (!userId) return 0;
  
  // Calculate simple hash from the string characters
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Return absolute index based on modulo number of shards
  return Math.abs(hash) % shards.length;
}

/**
 * Executes a query on the correct shard based on the user's ID.
 * @param {string} userId - The target User UUID for routing
 * @param {string} text - SQL query template
 * @param {Array} params - SQL query arguments
 */
async function queryRouted(userId, text, params) {
  const shardIndex = getShardIndex(userId);
  const targetPool = shards[shardIndex];
  
  console.log(`[DB Sharder] Routing query for User ID "${userId}" to Shard ${shardIndex + 1}`);
  return targetPool.query(text, params);
}

/**
 * Utility to run migrations/initialize tables on both database shards.
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

  for (let i = 0; i < shards.length; i++) {
    try {
      await shards[i].query(tableInitQuery);
      console.log(`[DB Sharder] Shard ${i + 1} initialized tables successfully.`);
    } catch (err) {
      console.error(`[DB Sharder Error] Failed to initialize Shard ${i + 1}:`, err.message);
    }
  }
}

module.exports = {
  query: queryRouted,
  initializeShards,
  getShardIndex,
  shards // exported in case of direct access/joins
};
