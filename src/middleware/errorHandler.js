const { BaseError, createErrorResponse } = require("@/utils/errors");
const { createLogger, logError } = require("@/utils/logger");
const { appConfig } = require("@/config");
const { brevoIntegration } = require("@/integrations/brevo");
const { EmailTemplateService } = require("@/services/emailTemplateService");

const logger = createLogger("middleware:errorHandler");

// Global error handler middleware
const errorHandler = (error, req, res, next) => {
  // Log the error
  logError(logger, error, {
    method: req.method,
    url: req.url,
    userAgent: req.headers["user-agent"],
    correlationId: req.correlationId,
    userId: req.user?.id,
  });

  // If response was already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error);
  }

  // Handle operational errors
  if (error instanceof BaseError) {
    const errorResponse = createErrorResponse(error);
    const statusCode = errorResponse.statusCode;

    // Send developer notification for 5xx errors from BaseError
    if (statusCode >= 500 && appConfig.server.developerEmail) {
      // Send notification asynchronously without blocking the response
      // Wrap in try-catch to ensure it doesn't break error handling
      setImmediate(async () => {
        try {
          const errorTemplate =
            EmailTemplateService.generateDeveloperErrorNotificationTemplate(
              error,
              req,
              statusCode,
              req.correlationId
            );

          await brevoIntegration.sendTransactionalEmail({
            senderEmail: `noreply@${appConfig.emailDomain}`,
            senderName: "Levitate Studios AI Agent",
            to: [appConfig.server.developerEmail],
            subject: errorTemplate.subject,
            htmlContent: errorTemplate.htmlContent,
          });

          logger.info(
            {
              statusCode,
              correlationId: req.correlationId,
              developerEmail: appConfig.server.developerEmail,
              errorCode: error.code,
            },
            "Developer error notification email sent for BaseError"
          );
        } catch (emailError) {
          // Log but don't throw - we don't want email failures to break error handling
          logger.error(
            {
              statusCode,
              correlationId: req.correlationId,
              emailError: emailError.message,
              originalError: error.message,
            },
            "Failed to send developer error notification email for BaseError"
          );
        }
      });
    }

    res.status(statusCode).json(errorResponse);
    return;
  }

  // Handle specific error types
  if (error.name === "ValidationError") {
    res.status(400).json({
      success: false,
      error: "Validation failed",
      message: error.message,
      statusCode: 400,
    });
    return;
  }

  if (error.name === "CastError") {
    res.status(400).json({
      success: false,
      error: "Invalid ID format",
      message: "The provided ID is not valid",
      statusCode: 400,
    });
    return;
  }

  if (error.name === "JsonWebTokenError") {
    res.status(401).json({
      success: false,
      error: "Invalid token",
      message: "The provided token is not valid",
      statusCode: 401,
    });
    return;
  }

  if (error.name === "TokenExpiredError") {
    res.status(401).json({
      success: false,
      error: "Token expired",
      message: "The provided token has expired",
      statusCode: 401,
    });
    return;
  }

  // Handle Prisma errors
  if (error.name === "PrismaClientKnownRequestError") {
    const prismaError = error;

    switch (prismaError.code) {
      case "P2002":
        res.status(409).json({
          success: false,
          error: "Conflict",
          message: "A record with this information already exists",
          statusCode: 409,
        });
        return;
      case "P2025":
        res.status(404).json({
          success: false,
          error: "Not found",
          message: "The requested record was not found",
          statusCode: 404,
        });
        return;
      case "P2003":
        res.status(400).json({
          success: false,
          error: "Foreign key constraint failed",
          message: "Referenced record does not exist",
          statusCode: 400,
        });
        return;
      default:
        // Fall through to generic error
        break;
    }
  }

  // Handle Prisma validation errors
  if (error.name === "PrismaClientValidationError") {
    res.status(400).json({
      success: false,
      error: "Database validation error",
      message:
        appConfig.server.nodeEnv === "development"
          ? error.message
          : "Invalid data provided",
      statusCode: 400,
    });
    return;
  }

  // Default error response for unhandled errors
  const statusCode = 500;
  const message =
    appConfig.server.nodeEnv === "development"
      ? error.message
      : "Internal server error";

  // Send developer notification for 5xx errors
  // Only send in production or if explicitly configured
  if (statusCode >= 500 && appConfig.server.developerEmail) {
    // Send notification asynchronously without blocking the response
    // Wrap in try-catch to ensure it doesn't break error handling
    setImmediate(async () => {
      try {
        const errorTemplate =
          EmailTemplateService.generateDeveloperErrorNotificationTemplate(
            error,
            req,
            statusCode,
            req.correlationId
          );

        await brevoIntegration.sendTransactionalEmail({
          senderEmail: `noreply@${appConfig.emailDomain}`,
          senderName: "Levitate Studios AI Agent",
          to: [appConfig.server.developerEmail],
          subject: errorTemplate.subject,
          htmlContent: errorTemplate.htmlContent,
        });

        logger.info(
          {
            statusCode,
            correlationId: req.correlationId,
            developerEmail: appConfig.server.developerEmail,
          },
          "Developer error notification email sent"
        );
      } catch (emailError) {
        // Log but don't throw - we don't want email failures to break error handling
        logger.error(
          {
            statusCode,
            correlationId: req.correlationId,
            emailError: emailError.message,
            originalError: error.message,
          },
          "Failed to send developer error notification email"
        );
      }
    });
  }

  res.status(statusCode).json({
    success: false,
    error: "Internal server error",
    message,
    statusCode,
    ...(appConfig.server.nodeEnv === "development" && { stack: error.stack }),
  });
};

// Async error wrapper to catch async errors in route handlers
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler for routes that don't exist
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: "Not found",
    message: `Route ${req.method} ${req.url} not found`,
    statusCode: 404,
  });
};

// Process uncaught exceptions and unhandled rejections
const setupGlobalErrorHandlers = () => {
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception:", error);

    // In production, we might want to restart the process
    if (appConfig.server.nodeEnv === "production") {
      process.exit(1);
    }
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);

    // In production, we might want to restart the process
    if (appConfig.server.nodeEnv === "production") {
      process.exit(1);
    }
  });

  // Graceful shutdown handling
  const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Close server and clean up resources
    // This will be implemented in the main server file
    process.exit(0);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
};

// Error response helper for route handlers
const sendErrorResponse = (res, error, statusCode = 500) => {
  if (error instanceof BaseError) {
    const errorResponse = createErrorResponse(error);
    res.status(errorResponse.statusCode).json(errorResponse);
  } else {
    // Handle string messages
    const message =
      typeof error === "string" ? error : error?.message || "An error occurred";

    res.status(statusCode).json({
      success: false,
      error: "Internal server error",
      statusCode,
      message:
        typeof error === "string"
          ? message
          : appConfig.server.nodeEnv === "development"
          ? error.message
          : "An error occurred",
      context: error?.context || error,
    });
  }
};

// Success response helper
const sendSuccessResponse = (res, data, message, statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    statusCode,
    message,
    data,
  });
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
  setupGlobalErrorHandlers,
  sendErrorResponse,
  sendSuccessResponse,
};
