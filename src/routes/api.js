const { Router } = require("express");
const crypto = require("crypto");
const { createLogger } = require("@/utils/logger");
const {
  asyncHandler,
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { ValidationError, BaseError } = require("@/utils/errors");
const { FormSubmissionService } = require("@/services/formSubmissionService");

const router = Router();
const logger = createLogger("routes:api");

/**
 * API endpoint for form submissions (direct API calls, not webhooks)
 * This demonstrates that the refactored services work for both webhook and API scenarios
 */
router.post(
  "/forms/submit",
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const correlationId =
      req.headers["x-correlation-id"] || crypto.randomUUID();

    logger.info({
      message: "API form submission request received",
      correlationId,
      method: req.method,
      url: req.url,
      contentType: req.headers["content-type"],
      userAgent: req.headers["user-agent"],
    });

    try {
      // Process form submission using orchestrator
      // Note: for API calls, we can choose to wait for async processing or skip it
      const skipAsyncProcessing = req.query.skipAsync === "true";

      const result = await FormSubmissionService.processAPISubmission(
        req.body,
        correlationId,
        skipAsyncProcessing
      );

      // Send success response
      sendSuccessResponse(res, {
        message: "Form submission processed successfully via API",
        correlationId: result.correlationId,
        responseId: result.responseId,
        formId: result.formId,
        clientId: result.clientId,
        projectId: result.projectId,
        timestamp: result.timestamp,
        processingTime: result.processingTime,
        asyncProcessingCompleted: result.asyncProcessingCompleted || false,
        skipAsyncProcessing,
      });

      logger.info({
        message: "API form submission processed successfully",
        correlationId: result.correlationId,
        responseId: result.responseId,
        formId: result.formId,
        clientId: result.clientId,
        projectId: result.projectId,
        processingTime: result.processingTime,
        skipAsyncProcessing,
      });
    } catch (error) {
      // Check if it's a duplicate submission error
      if (error.code === "P2002" && error.meta?.target?.includes("formId")) {
        logger.warn({
          message: "Duplicate form submission detected via API",
          correlationId,
          error: error.message,
        });

        // Return success for duplicate submissions to avoid retry loops
        return sendSuccessResponse(res, {
          message: "Form submission already processed",
          correlationId,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          duplicate: true,
        });
      }

      // Comprehensive error handling and logging
      const errorInfo = {
        message: "API form submission failed",
        correlationId,
        error: error.message,
        errorType: error.constructor.name,
        processingTime: Date.now() - startTime,
        requestInfo: {
          method: req.method,
          url: req.url,
          headers: {
            contentType: req.headers["content-type"],
            userAgent: req.headers["user-agent"],
          },
          body: {
            hasBody: !!req.body,
            bodyKeys: req.body ? Object.keys(req.body) : [],
          },
        },
      };

      // Add stack trace for non-validation errors
      if (!(error instanceof ValidationError)) {
        errorInfo.stack = error.stack;
      }

      logger.error(errorInfo);

      // Send appropriate error response
      if (error instanceof ValidationError) {
        return sendErrorResponse(res, error, 400);
      } else {
        // For unexpected errors, log more details but send generic message
        logger.error({
          message: "Unexpected error in API form processing",
          correlationId,
          fullError: error,
          stack: error.stack,
        });
        return sendErrorResponse(
          res,
          new BaseError("Internal server error"),
          500
        );
      }
    }
  })
);

module.exports = { apiRouter: router };
