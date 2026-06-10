const { redisClient } = require('./redis');

const QUEUE_NAME = 'carbon_write_jobs';

/**
 * Publishes a footprint calculation write job into the Redis task queue.
 * @param {Object} jobPayload - Footprint details and user credentials
 */
async function publishJob(jobPayload) {
  try {
    const messageString = JSON.stringify(jobPayload);
    // Push task onto list from the right (FIFO)
    await redisClient.rPush(QUEUE_NAME, messageString);
    console.log(`[Event Broker] Published footprint job for user: ${jobPayload.user.username}`);
    return true;
  } catch (err) {
    console.error('[Event Broker Error] Failed to publish job:', err.message);
    return false;
  }
}

/**
 * Subscribes a consumer worker to process jobs from the Redis queue.
 * Operates an infinite loop using blocking list pop to prevent active polling.
 * @param {Function} processCallback - Async function invoked to execute the job
 */
async function subscribe(processCallback) {
  console.log(`[Event Broker] Worker subscribed to queue: "${QUEUE_NAME}"`);
  
  // Continuous worker thread loop
  while (true) {
    try {
      // BLPOP returns key name and value of first element available.
      // Set timeout of 0 to block indefinitely until an element is pushed.
      const result = await redisClient.blPop(QUEUE_NAME, 0);
      
      if (result && result.element) {
        const job = JSON.parse(result.element);
        console.log(`[Event Broker] Worker consumed job for: ${job.user.username}`);
        await processCallback(job);
      }
    } catch (err) {
      console.error('[Event Broker Error] Subscription consumer crash:', err.message);
      // Wait a moment before restarting consumer loop to prevent spamming logs on Redis crash
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

module.exports = {
  publishJob,
  subscribe
};
