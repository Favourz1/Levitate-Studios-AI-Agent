require("module-alias/register");
const express = require("express");
const { createBullBoard } = require("@bull-board/api");
const { ExpressAdapter } = require("@bull-board/express");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { queues, QUEUE_NAMES } = require("../queues");
const { createLogger } = require("../utils/logger");

const logger = createLogger("monitoring:queue");

// Initialize Express app
const app = express();

// Set up Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

// Create BullMQ adapters for all queues
const queueAdapters = Object.entries(queues).map(
  ([name, queue]) => new BullMQAdapter(queue)
);

// Initialize Bull Board
createBullBoard({
  queues: queueAdapters,
  serverAdapter,
});

// Add basic security middleware
app.use("/admin/queues", (req, res, next) => {
  // TODO:In production, you might want to add proper authentication
  // This is a basic example for local development
  const isLocal = req.ip === "127.0.0.1" || req.ip === "::1";
  if (!isLocal && process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
});

// Mount the Bull Board UI
app.use("/admin/queues", serverAdapter.getRouter());

// Add a simple status endpoint
app.get("/status", async (req, res) => {
  try {
    const status = {};

    for (const [name, queue] of Object.entries(queues)) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      status[name] = {
        waiting,
        active,
        completed,
        failed,
        delayed,
      };
    }

    res.json({
      status: "healthy",
      queues: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Failed to get queue status:", error);
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Start the server
const PORT = process.env.MONITOR_PORT || 3567; // Using a different port than your main app
app.listen(PORT, () => {
  logger.info(
    `Queue Monitor UI is running at http://localhost:${PORT}/admin/queues`
  );
  logger.info(
    `Queue Status API is available at http://localhost:${PORT}/status`
  );

  // Log information about monitored queues
  logger.info("Monitoring queues:", Object.keys(QUEUE_NAMES));
});
