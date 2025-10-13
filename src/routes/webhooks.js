/* eslint-disable no-unreachable */
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
const { EmailInboundService } = require("@/services/emailInboundService");

const router = Router();
const logger = createLogger("routes:webhooks");

// Brevo inbound webhook route
router.post(
  "/brevo/inbound",
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const correlationId =
      req.headers["x-correlation-id"] || crypto.randomUUID();

    logger.info(
      {
        correlationId,
        method: req.method,
        url: req.url,
        contentType: req.headers["content-type"],
        contentLength: req.headers["content-length"],
        userAgent: req.headers["user-agent"],
      },
      "Brevo inbound webhook request received"
    );

    try {
      // Brevo sends JSON payload directly in body
      const payload = req.body;

      if (!payload || typeof payload !== "object") {
        throw new ValidationError(
          "Invalid payload: expected JSON object from Brevo"
        );
      }

      logger.info(
        {
          correlationId,
          itemsCount: payload.items?.length || 0,
        },
        "Processing Brevo inbound webhook payload"
      );

      // Process the webhook using EmailInboundService
      const result = await EmailInboundService.processBrevoInboundWebhook(
        payload,
        correlationId
      );

      const processingTime = Date.now() - startTime;

      // Send immediate success response
      sendSuccessResponse(res, {
        message: "Brevo inbound webhook processed successfully",
        correlationId,
        totalItems: result.totalItems,
        processed: result.processed,
        skipped: result.skipped,
        failed: result.failed,
        processingTime,
        timestamp: new Date().toISOString(),
      });

      logger.info(
        {
          correlationId,
          totalItems: result.totalItems,
          processed: result.processed,
          skipped: result.skipped,
          failed: result.failed,
          processingTime,
        },
        "Brevo inbound webhook processed successfully"
      );
    } catch (error) {
      const processingTime = Date.now() - startTime;

      logger.error(
        {
          correlationId,
          error: error.message,
          errorType: error.constructor.name,
          processingTime,
          stack: error.stack,
        },
        "Brevo inbound webhook processing failed"
      );

      // Send error response
      if (error instanceof ValidationError) {
        return sendErrorResponse(res, error, 400);
      } else {
        return sendErrorResponse(
          res,
          new BaseError("Internal server error processing inbound email"),
          500
        );
      }
    }
  })
);

// Asana webhook route
router.post(
  "/asana",
  asyncHandler(async (req, res) => {
    // TODO: Implement Asana webhook handler
    sendSuccessResponse(res, { message: "Webhook received" });
  })
);

// Google Apps Script form submission webhook with comprehensive error handling
router.post(
  "/apps-script/forms",
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const correlationId =
      req.headers["x-correlation-id"] || crypto.randomUUID();

    logger.info({
      message: "Webhook request received",
      correlationId,
      method: req.method,
      url: req.url,
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
      userAgent: req.headers["user-agent"],
      hasRawBodyBuffer: !!req.rawBodyBuffer,
      hasRawBodyString: !!req.rawBodyString,
    });

    try {
      // Step 1: Validate that we have raw body data (should be ensured by middleware)
      if (!req.rawBodyBuffer || !Buffer.isBuffer(req.rawBodyBuffer)) {
        throw new ValidationError(
          "Raw body buffer not available. This indicates a middleware configuration issue."
        );
      }

      // Step 2: Process form submission using FormSubmissionService
      const result = await FormSubmissionService.processWebhookSubmission(
        req,
        correlationId
      );

      // Step 3: Send success response immediately
      sendSuccessResponse(res, {
        message: "Form submission processed successfully",
        correlationId: result.correlationId,
        responseId: result.responseId,
        formId: result.formId,
        clientId: result.clientId,
        projectId: result.projectId,
        timestamp: result.timestamp,
        processingTime: result.processingTime,
      });

      // Step 4: Log final success
      logger.info({
        message: "Form submission webhook processed successfully",
        correlationId: result.correlationId,
        responseId: result.responseId,
        formId: result.formId,
        clientId: result.clientId,
        projectId: result.projectId,
        processingTime: result.processingTime,
      });
    } catch (error) {
      // Check if it's a duplicate submission error
      if (error.code === "P2002" && error.meta?.target?.includes("formId")) {
        logger.warn({
          message: "Duplicate form submission detected",
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
        message: "Form submission webhook failed",
        correlationId,
        error: error.message,
        errorType: error.constructor.name,
        processingTime: Date.now() - startTime,
        requestInfo: {
          method: req.method,
          url: req.url,
          headers: {
            contentType: req.headers["content-type"],
            contentLength: req.headers["content-length"],
            userAgent: req.headers["user-agent"],
            signature: req.headers["x-apps-script-signature"]
              ? `${req.headers["x-apps-script-signature"].substring(0, 8)}...`
              : null,
            responseId: req.headers["x-form-response-id"],
          },
          body: {
            hasRawBuffer: !!req.rawBodyBuffer,
            hasRawString: !!req.rawBodyString,
            rawBufferLength: req.rawBodyBuffer ? req.rawBodyBuffer.length : 0,
          },
        },
      };

      // Add error context if available
      if (error.context) {
        errorInfo.errorContext = error.context;
      }

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
          message: "Unexpected error in webhook processing",
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

module.exports = { webhooksRouter: router };
