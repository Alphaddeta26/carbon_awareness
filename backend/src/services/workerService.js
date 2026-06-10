const broker = require('../config/broker');
const db = require('../config/db');
const redis = require('../config/redis');

// National per capita daily emission baseline in kg CO2
const BASE_DAILY_AVG = 16.0;

/**
 * Worker Processor logic executed for every footprint job consumed.
 * Performs database sharded writes and updates the global Redis leaderboard.
 */
async function processFootprintJob(job) {
  const { user, scores } = job;
  const username = user.username;
  const userId = user.id;

  try {
    const totalFootprint = scores.travel + scores.energy + scores.food + scores.waste;
    
    // 1. Write footprint log into the correct sharded database pool
    const insertSql = `
      INSERT INTO footprints (user_id, travel_score, energy_score, food_score, waste_score, total_footprint)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    
    // Execute SQL on pool resolved by the Consistent Hash Ring
    await db.query(username, insertSql, [
      userId,
      scores.travel,
      scores.energy,
      scores.food,
      scores.waste,
      totalFootprint
    ]);
    console.log(`[Worker] Saved footprint log for "${username}" to SQL Shard.`);

    // 2. Fetch all historical logs to calculate new cumulative savings
    const historySql = 'SELECT total_footprint FROM footprints WHERE user_id = $1';
    const logsResult = await db.query(username, historySql, [userId]);
    
    const totalSaved = logsResult.rows.reduce((sum, log) => sum + (BASE_DAILY_AVG - log.total_footprint), 0);

    // 3. Update Sorted Set score in Redis
    await redis.updateLeaderboard(username, totalSaved.toFixed(2));
    console.log(`[Worker] Synced leaderboard score for "${username}" to Redis: ${totalSaved.toFixed(2)} kg`);
    
  } catch (err) {
    console.error(`[Worker Error] Failed to process job for user "${username}":`, err.message);
  }
}

/**
 * Initializes and starts the worker daemon.
 */
function startWorker() {
  console.log('[Worker] Starting background execution thread...');
  
  // Initialize SQL sharded database tables
  db.initializeShards().then(() => {
    // Start consuming tasks from Redis streams broker list
    broker.subscribe(processFootprintJob);
  });
}

module.exports = {
  startWorker
};
if (require.main === module) {
  startWorker();
}
