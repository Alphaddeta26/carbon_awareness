const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./config/db');
const redis = require('./config/redis');

// Import microservice routers
const authService = require('./services/authService');
const ingestionService = require('./services/ingestionService');
const leaderboardService = require('./services/leaderboardService');
const workerService = require('./services/workerService');

require('dotenv').config();

const app = express();
const SERVICE_TYPE = process.env.SERVICE_TYPE || 'monolith';
const PORT = process.env.PORT || 5000;

// Apply standard global security and parser middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(redis.rateLimiter); // IP rate-limiting protection

console.log(`[Bootstrap] Starting application in mode: "${SERVICE_TYPE}"`);

// --------------------------------------------------------------------------
// ROUTING SELECTOR (Microservice vs Monolithic)
// --------------------------------------------------------------------------

if (SERVICE_TYPE === 'auth') {
  // Mount Auth routes only
  app.use('/api/auth', authService);
  startHttpServer();
} 

else if (SERVICE_TYPE === 'ingestion') {
  // Mount Ingestion and History routes only
  app.use('/api', ingestionService);
  startHttpServer();
} 

else if (SERVICE_TYPE === 'leaderboard') {
  // Mount Leaderboard ranking route only
  app.use('/api', leaderboardService);
  startHttpServer();
} 

else if (SERVICE_TYPE === 'worker') {
  // Run background worker daemon (no HTTP listener required)
  workerService.startWorker();
} 

else {
  // Monolithic unified development mode - Mount all routes
  app.use('/api/auth', authService);
  app.use('/api', ingestionService);
  app.use('/api', leaderboardService);
  
  // Start Http listener and initialize DB tables
  db.initializeShards().then(() => {
    app.listen(PORT, () => {
      console.log(`[Monolith] Web service listening on http://localhost:${PORT}`);
    });
  });
}

// Helper to launch service HTTP listener
function startHttpServer() {
  db.initializeShards().then(() => {
    app.listen(PORT, () => {
      console.log(`[Service: ${SERVICE_TYPE}] Web service listening on http://localhost:${PORT}`);
    });
  });
}
