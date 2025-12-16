require("module-alias/register");
const express = require("express");
const helmet = require("helmet");
const { appConfig } = require("@/config");
const { createPrismaClient } = require("@/database");
const {
  errorHandler,
  notFoundHandler,
  setupGlobalErrorHandlers,
  asyncHandler,
} = require("@/middleware/errorHandler");
const {
  //   skipHealthCheckLogging,
  securityHeaders,
  //   requestSanitizer,
  //   requestTiming,
  ipTracker,
  userAgentLogger,
} = require("@/middleware/logging");
const { corsMiddleware } = require("@/middleware/cors");
// const { rateLimits } = require("@/middleware/rateLimit");
const { apiRouter } = require("@/routes");
const {
  createLogger,
  // logError
} = require("@/utils/logger");
const { shutdownQueues } = require("@/queues");

const logger = createLogger("server");

// Create Express app
const app = express();

// Setup global error handlers
setupGlobalErrorHandlers();

// Initialize database connection
const prisma = createPrismaClient();

// Trust proxy settings (for accurate IP addresses behind load balancers)
app.set("trust proxy", 1);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // We set this manually in middleware
    crossOriginEmbedderPolicy: false,
  })
);
app.use(securityHeaders);

// CORS middleware
app.use(corsMiddleware);

// Special middleware for webhook routes - preserve raw body for ALL apps-script endpoints
app.use(
  ["/api/webhooks/", "/api/v1/webhooks/apps-script/forms"],
  express.raw({
    type: "application/json",
    limit: "50mb",
  }),
  (req, res, next) => {
    // Store the raw body buffer in a separate field for signature validation
    req.rawBodyBuffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body || "", "utf8");

    // Also store original raw body string for debugging
    req.rawBodyString = req.rawBodyBuffer.toString("utf8");

    next();
  }
);

// Standard JSON parsing middleware for other routes
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request logging and tracking
app.use(ipTracker);
app.use(userAgentLogger);
// app.use(requestTiming);
// app.use(skipHealthCheckLogging);

// Request sanitization and size checking
// app.use(requestSanitizer);

// General rate limiting (with health check skip)
// app.use(rateLimits.apiWithHealthSkip);

// API routes
app.use("/api/v1", apiRouter);

// Root redirect
app.get(
  "/",
  asyncHandler(async (req, res) => {
    res.redirect("/api/v1/healthz");
  })
);

// 404 handler
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// Server startup
const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info("Database connected successfully");

    // Start server
    const server = app.listen(appConfig.server.port, () => {
      logger.info(
        {
          port: appConfig.server.port,
          nodeEnv: appConfig.server.nodeEnv,
        },
        "Server started successfully"
      );
    });

    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(async () => {
        try {
          // Close database connection
          await prisma.$disconnect();
          logger.info("Database disconnected");

          // Shutdown queues
          await shutdownQueues();

          logger.info("Graceful shutdown completed");
          process.exit(0);
        } catch (error) {
          logger.error("Error during graceful shutdown:", error);
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error("Forced shutdown due to timeout");
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      gracefulShutdown("unhandledRejection");
    });
  } catch (error) {
    // TODO: Everywhere in codebase using logger.error should follow this format
    logger.error(
      {
        err: error,
        context: "Failed to start server",
        stack: error.stack,
      },
      error.message
    );
    // logError(logger, error, "start server failed");
    process.exit(1);
  }
};

// Start the server
if (require.main === module) {
  startServer().catch((error) => {
    logger.error("Server startup failed:", error);
    process.exit(1);
  });
}

module.exports = { app, startServer };
module.exports.default = startServer;
