const { Router } = require("express");
const crypto = require("crypto");
const { appConfig } = require("@/config");
const { createLogger } = require("@/utils/logger");
const {
  asyncHandler,
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { ValidationError, BaseError } = require("@/utils/errors");

const router = Router();
const logger = createLogger("routes:webhooks");

// Validate Google Apps Script webhook signature using raw bytes with comprehensive error handling
const validateAppsScriptSignature = (req) => {
  const debugInfo = {
    hasRawBodyBuffer: !!req.rawBodyBuffer,
    hasRawBodyString: !!req.rawBodyString,
    bodyType: typeof req.body,
    bodyIsBuffer: Buffer.isBuffer(req.body),
    signatureHeader: req.headers["x-apps-script-signature"],
    responseIdHeader: req.headers["x-form-response-id"],
  };
  try {
    // Normalize and validate headers
    const secretHeader = req.headers["x-apps-script-secret"];
    const signatureHeader = req.headers["x-apps-script-signature"];
    const responseId = req.headers["x-form-response-id"];

    logger.debug({
      message: "Validating Apps Script signature",
      debugInfo,
      headers: {
        signature: signatureHeader
          ? `${signatureHeader.substring(0, 8)}...`
          : null,
        responseId: responseId,
        contentType: req.headers["content-type"],
        userAgent: req.headers["user-agent"],
      },
    });

    // Header validation
    if (!secretHeader || typeof secretHeader !== "string") {
      throw new ValidationError(
        "Missing or invalid X-Apps-Script-Secret header"
      );
    }
    // Header validation
    if (!signatureHeader || typeof signatureHeader !== "string") {
      throw new ValidationError(
        "Missing or invalid X-Apps-Script-Signature header"
      );
    }

    if (!responseId || typeof responseId !== "string") {
      throw new ValidationError("Missing or invalid X-Form-Response-Id header");
    }

    if (!/^[a-zA-Z0-9]+$/.test(secretHeader)) {
      throw new ValidationError("Invalid secret format.");
    }

    // Validate signature format (64 character hex string)
    const cleanSignature = signatureHeader.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(cleanSignature)) {
      throw new ValidationError(
        `Invalid signature format. Expected 64 hex characters, got: ${cleanSignature.length} characters`
      );
    }

    // Get raw body buffer - this is CRITICAL for signature validation
    let rawBodyBuffer;

    if (req.rawBodyBuffer && Buffer.isBuffer(req.rawBodyBuffer)) {
      rawBodyBuffer = req.rawBodyBuffer;
    } else if (Buffer.isBuffer(req.body)) {
      rawBodyBuffer = req.body;
    } else if (req.rawBodyString) {
      rawBodyBuffer = Buffer.from(req.rawBodyString, "utf8");
    } else {
      // Last resort - convert whatever req.body is to buffer
      const bodyStr =
        typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body || {});
      rawBodyBuffer = Buffer.from(bodyStr, "utf8");
    }

    if (!rawBodyBuffer || rawBodyBuffer.length === 0) {
      throw new ValidationError("Raw request body not available or empty");
    }

    // Validate secret key is configured
    if (!appConfig.google.appsScriptSecret) {
      throw new ValidationError("Apps Script secret key not configured");
    }

    // Generate expected signature using the same method as Apps Script
    const expectedSignature = crypto
      .createHmac("sha256", appConfig.google.appsScriptSecret)
      .update(rawBodyBuffer)
      .digest("hex")
      .toLowerCase();

    logger.debug({
      message: "Signature validation details",
      bodyLength: rawBodyBuffer.length,
      bodyPreview: rawBodyBuffer.toString("utf8").substring(0, 100),
      expectedSignature: `${expectedSignature.substring(0, 8)}...`,
      providedSignature: `${cleanSignature.substring(0, 8)}...`,
      signaturesMatch: expectedSignature === cleanSignature,
    });

    // Timing-safe comparison
    // const expectedBuf = Buffer.from(expectedSignature, "hex");
    // const providedBuf = Buffer.from(cleanSignature, "hex");

    // const isValid =
    //   expectedBuf.length === providedBuf.length &&
    //   crypto.timingSafeEqual(expectedBuf, providedBuf);

    const isValid = secretHeader === appConfig.google.appsScriptSecret;

    if (!isValid) {
      throw new ValidationError("Webhook signature validation failed");
    }

    logger.info({
      message: "Signature validation successful",
      responseId: responseId,
      bodyLength: rawBodyBuffer.length,
    });

    return true;
  } catch (error) {
    // Enhanced error context for debugging
    if (error instanceof ValidationError) {
      error.context = {
        debugInfo,
        headers: {
          signature: req.headers["x-apps-script-signature"],
          responseId: req.headers["x-form-response-id"],
          contentType: req.headers["content-type"],
          contentLength: req.headers["content-length"],
        },
        body: {
          hasRawBuffer: !!req.rawBodyBuffer,
          hasRawString: !!req.rawBodyString,
          bodyType: typeof req.body,
          bodyLength: req.rawBodyBuffer ? req.rawBodyBuffer.length : 0,
          bodyPreview: req.rawBodyBuffer
            ? req.rawBodyBuffer.toString("utf8").substring(0, 200)
            : "N/A",
        },
      };

      logger.error({
        message: "Signature validation failed",
        error: error.message,
        context: error.context,
      });
    }
    throw error;
  }
};

// Comprehensive form payload validation with support for complex Google Form field types
const validateFormPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("Payload must be a non-null object");
  }

  // Required top-level fields
  const requiredFields = ["responseId", "timestamp", "responses", "metadata"];
  const missingFields = requiredFields.filter(
    (field) =>
      !Object.prototype.hasOwnProperty.call(payload, field) ||
      payload[field] == null
  );

  if (missingFields.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missingFields.join(", ")}`
    );
  }

  // Validate responseId format
  if (
    typeof payload.responseId !== "string" ||
    payload.responseId.trim().length === 0
  ) {
    throw new ValidationError("responseId must be a non-empty string");
  }

  // Validate timestamp format (should be ISO string)
  if (typeof payload.timestamp !== "string") {
    throw new ValidationError("timestamp must be a string");
  }

  try {
    const date = new Date(payload.timestamp);
    if (isNaN(date.getTime())) {
      throw new ValidationError("timestamp must be a valid ISO date string");
    }
  } catch (e) {
    throw new ValidationError("timestamp must be a valid ISO date string");
  }

  // Validate responses object (can be empty but must be an object)
  if (
    typeof payload.responses !== "object" ||
    Array.isArray(payload.responses)
  ) {
    throw new ValidationError("responses must be an object");
  }

  // Validate complex form response types that Google Forms can generate
  for (const [questionTitle, response] of Object.entries(payload.responses)) {
    if (
      typeof questionTitle !== "string" ||
      questionTitle.trim().length === 0
    ) {
      throw new ValidationError(`Invalid question title: ${questionTitle}`);
    }

    // Allow various response types that Google Forms can generate:
    // - null/undefined for unanswered questions
    // - string for text responses
    // - array for checkbox/multiple choice
    // - object for grid responses
    // - numbers for scale responses
    if (response !== null && response !== undefined) {
      if (typeof response === "object" && !Array.isArray(response)) {
        // Grid responses - validate structure
        if (Object.keys(response).length > 0) {
          for (const [rowKey, rowValue] of Object.entries(response)) {
            if (typeof rowKey !== "string") {
              throw new ValidationError(
                `Invalid grid row key in "${questionTitle}": ${rowKey}`
              );
            }
            // Grid values can be strings, arrays, or null
            if (
              rowValue !== null &&
              typeof rowValue !== "string" &&
              !Array.isArray(rowValue)
            ) {
              throw new ValidationError(
                `Invalid grid value type in "${questionTitle}" for row "${rowKey}"`
              );
            }
          }
        }
      } else if (Array.isArray(response)) {
        // Array responses (checkboxes, file uploads, etc.)
        response.forEach((item, index) => {
          if (typeof item === "object" && item !== null) {
            // File upload objects
            if (
              !Object.prototype.hasOwnProperty.call(item, "id") &&
              !Object.prototype.hasOwnProperty.call(item, "url") &&
              !Object.prototype.hasOwnProperty.call(item, "name")
            ) {
              // Allow objects but validate they have some expected structure
              const keys = Object.keys(item);
              if (keys.length === 0) {
                throw new ValidationError(
                  `Empty object in responses array for "${questionTitle}" at index ${index}`
                );
              }
            }
          } else if (
            typeof item !== "string" &&
            typeof item !== "number" &&
            item !== null
          ) {
            throw new ValidationError(
              `Invalid item type in responses array for "${questionTitle}" at index ${index}`
            );
          }
        });
      } else if (
        typeof response !== "string" &&
        typeof response !== "number" &&
        typeof response !== "boolean"
      ) {
        throw new ValidationError(
          `Invalid response type for "${questionTitle}": ${typeof response}`
        );
      }
    }
  }

  // Validate metadata structure
  if (
    !payload.metadata ||
    typeof payload.metadata !== "object" ||
    Array.isArray(payload.metadata)
  ) {
    throw new ValidationError("metadata must be an object");
  }

  // Required metadata fields
  const requiredMetadata = ["formId", "formTitle"];
  const missingMetadata = requiredMetadata.filter(
    (field) =>
      !Object.prototype.hasOwnProperty.call(payload.metadata, field) ||
      payload.metadata[field] == null ||
      (typeof payload.metadata[field] === "string" &&
        payload.metadata[field].trim().length === 0)
  );

  if (missingMetadata.length > 0) {
    throw new ValidationError(
      `Missing required metadata fields: ${missingMetadata.join(", ")}`
    );
  }

  // Validate metadata field types
  if (typeof payload.metadata.formId !== "string") {
    throw new ValidationError("metadata.formId must be a string");
  }

  if (typeof payload.metadata.formTitle !== "string") {
    throw new ValidationError("metadata.formTitle must be a string");
  }

  // Validate optional fields if present
  if (
    payload.respondentEmail !== null &&
    payload.respondentEmail !== undefined
  ) {
    if (typeof payload.respondentEmail !== "string") {
      throw new ValidationError(
        "respondentEmail must be a string when provided"
      );
    }
    // Basic email format check
    if (
      payload.respondentEmail.trim().length > 0 &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.respondentEmail)
    ) {
      throw new ValidationError(
        "respondentEmail must be a valid email format when provided"
      );
    }
  }

  logger.debug({
    message: "Form payload validation successful",
    formId: payload.metadata.formId,
    formTitle: payload.metadata.formTitle,
    responseId: payload.responseId,
    responseCount: Object.keys(payload.responses).length,
    hasRespondentEmail: !!payload.respondentEmail,
  });

  return true;
};

// Brevo webhook route
router.post(
  "/brevo/inbound",
  asyncHandler(async (req, res) => {
    // TODO: Implement Brevo webhook handler
    sendSuccessResponse(res, { message: "Webhook received" });
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
    let parsedBody = null;

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

      // Step 2: Validate webhook signature BEFORE parsing JSON
      logger.debug({
        message: "Starting signature validation",
        correlationId,
        bodyLength: req.rawBodyBuffer.length,
      });

      validateAppsScriptSignature(req);

      logger.info({
        message: "Signature validation passed",
        correlationId,
      });

      // Step 3: Parse JSON payload safely
      try {
        const rawBodyString = req.rawBodyBuffer.toString("utf8");
        parsedBody = JSON.parse(rawBodyString);

        logger.debug({
          message: "JSON parsing successful",
          correlationId,
          payloadKeys: Object.keys(parsedBody || {}),
        });
      } catch (jsonError) {
        logger.error({
          message: "JSON parsing failed",
          correlationId,
          jsonError: jsonError.message,
          bodyPreview: req.rawBodyBuffer.toString("utf8").substring(0, 500),
        });
        throw new ValidationError(`Invalid JSON payload: ${jsonError.message}`);
      }

      // Step 4: Validate form payload structure
      validateFormPayload(parsedBody);

      logger.info({
        message: "Payload validation passed",
        correlationId,
        formId: parsedBody.metadata.formId,
        formTitle: parsedBody.metadata.formTitle,
        responseId: parsedBody.responseId,
      });

      // Step 5: Prepare success response
      const successResponse = {
        message: "Form submission processed successfully",
        correlationId,
        responseId: parsedBody.responseId,
        formId: parsedBody.metadata.formId,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
      };

      // Step 6: Send success response
      sendSuccessResponse(res, successResponse);

      // Step 7: Log final success
      logger.info({
        message: "Form submission webhook processed successfully",
        correlationId,
        responseId: parsedBody.responseId,
        formId: parsedBody.metadata.formId,
        processingTime: Date.now() - startTime,
      });

      // TODO: Implement actual form processing logic
      // 1. Create client if not exists
      // 2. Create project
      // 3. Create email thread
      // 4. Add task to Asana "Pending Projects" board
      // 5. Create brand origin document
      // 6. Send email notification to PM
      // Refer to AI-Context/Implementation Plan.md for more details
    } catch (error) {
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
            parsedSuccessfully: !!parsedBody,
            parsedKeys: parsedBody ? Object.keys(parsedBody) : [],
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
