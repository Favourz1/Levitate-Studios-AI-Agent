const { Router } = require("express");
const { checkDatabaseHealth } = require("@/database");
const { checkQueuesHealth } = require("@/queues");
const {
  asyncHandler,
  sendSuccessResponse,
} = require("@/middleware/errorHandler");

const router = Router();

// Basic health check
router.get(
  "/healthz",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, {
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  })
);

// Detailed readiness check
router.get(
  "/readyz",
  asyncHandler(async (req, res) => {
    const [dbHealth, queueHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkQueuesHealth(),
    ]);

    const isReady =
      dbHealth &&
      queueHealth.redis &&
      Object.values(queueHealth.queues).every(Boolean);

    const healthData = {
      status: isReady ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealth,
        redis: queueHealth.redis,
        queues: queueHealth.queues,
      },
    };

    if (isReady) {
      sendSuccessResponse(res, healthData);
    } else {
      res.status(503).json({
        success: false,
        data: healthData,
        error: "Service not ready",
      });
    }
  })
);

module.exports = { healthRouter: router };
