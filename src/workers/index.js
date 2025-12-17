require("module-alias/register");
const { redis, QUEUE_NAMES, createWorker } = require("@/queues");
const { createLogger } = require("@/utils/logger");
const { setupGlobalErrorHandlers } = require("@/middleware/errorHandler");

// Import worker processors
const { documentGenerationProcessor } = require("@/workers/documentGeneration");
const {
  emailIntentProcessor,
  feedbackIntentProcessor,
} = require("@/workers/emailIntent");
const { asanaSyncProcessor } = require("@/workers/asanaSync");
const { asanaProjectInitProcessor } = require("@/workers/asanaProjectInit");
const { quoteGenerationProcessor } = require("@/workers/quoteGeneration");
const { notificationProcessor } = require("@/workers/notifications");
const { snapshotSyncProcessor } = require("@/workers/snapshotSync");
const { workplanGenerationProcessor } = require("@/workers/workplanGeneration");

const logger = createLogger("workers");

// Worker instances
const workers = [];

// Start all workers
const startWorkers = async () => {
  logger.info("Starting background workers...");

  try {
    // Setup global error handlers
    setupGlobalErrorHandlers();

    // Create and start all workers
    const workerConfigs = [
      {
        name: QUEUE_NAMES.DOC_GENERATION,
        processor: documentGenerationProcessor,
        concurrency: 3, // Limit concurrent document generation
      },
      {
        name: QUEUE_NAMES.QUOTE_GENERATION,
        processor: quoteGenerationProcessor,
        concurrency: 4,
      },
      {
        name: QUEUE_NAMES.EMAIL_INTENT,
        processor: emailIntentProcessor,
        concurrency: 5, // Higher concurrency for email processing
      },
      {
        name: QUEUE_NAMES.FEEDBACK_INTENT,
        processor: feedbackIntentProcessor,
        concurrency: 3, // Moderate concurrency for feedback intent detection
      },
      {
        name: QUEUE_NAMES.ASANA_SYNC,
        processor: asanaSyncProcessor,
        concurrency: 3, // Moderate concurrency for Asana operations
      },
      {
        name: QUEUE_NAMES.ASANA_PROJECT_INIT,
        processor: asanaProjectInitProcessor,
        concurrency: 1, // Serial processing for project initialization
      },
      {
        name: QUEUE_NAMES.NOTIFICATIONS,
        processor: notificationProcessor,
        concurrency: 5, // Higher concurrency for notifications
      },
      {
        name: QUEUE_NAMES.SNAPSHOT_SYNC,
        processor: snapshotSyncProcessor,
        concurrency: 2, // Moderate concurrency for sync operations
      },
      {
        name: QUEUE_NAMES.WORKPLAN_GENERATION,
        processor: workplanGenerationProcessor,
        concurrency: 2, // Moderate concurrency for workplan generation
      },
    ];

    for (const config of workerConfigs) {
      const worker = createWorker(
        config.name,
        config.processor,
        config.concurrency
      );

      workers.push(worker);
      logger.info(
        {
          queueName: config.name,
          concurrency: config.concurrency,
        },
        "Worker started"
      );
    }

    logger.info(`Started ${workers.length} workers successfully`);

    // Handle graceful shutdown
    const gracefulShutdown = async (signal) => {
      logger.info(
        `Received ${signal}. Starting graceful shutdown of workers...`
      );

      try {
        // Close all workers
        await Promise.all(
          workers.map(async (worker) => {
            logger.info(`Closing worker for queue: ${worker.name}`);
            await worker.close();
          })
        );

        // Close Redis connection
        await redis.quit();

        logger.info("All workers shut down gracefully");
        process.exit(0);
      } catch (error) {
        logger.error("Error during graceful shutdown:", error);
        process.exit(1);
      }
    };

    // Handle shutdown signals
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch (error) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      "Failed to start workers"
    );
    process.exit(1);
  }
};

// Stop all workers
const stopWorkers = async () => {
  logger.info("Stopping background workers...");

  try {
    await Promise.all(workers.map((worker) => worker.close()));
    await redis.quit();
    logger.info("All workers stopped successfully");
  } catch (error) {
    logger.error("Error stopping workers:", error);
    throw error;
  }
};

// Start workers if this file is executed directly
if (require.main === module) {
  startWorkers().catch((error) => {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      "Failed to start workers"
    );
    process.exit(1);
  });
}

module.exports = {
  startWorkers,
  stopWorkers,
};
