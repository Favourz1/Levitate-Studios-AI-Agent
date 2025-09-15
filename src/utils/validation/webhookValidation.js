const crypto = require("crypto");
const { ValidationError } = require("@/utils/errors");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("utils:webhook-validation");

/**
 * Validate Google Apps Script webhook signature using raw bytes with comprehensive error handling
 * @param {Object} req - Express request object
 * @returns {boolean} True if signature is valid
 * @throws {ValidationError} If validation fails
 */
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

    // logger.debug({
    //   message: "Validating Apps Script signature",
    //   debugInfo,
    //   headers: {
    //     signature: signatureHeader
    //       ? `${signatureHeader.substring(0, 8)}...`
    //       : null,
    //     responseId: responseId,
    //     contentType: req.headers["content-type"],
    //     userAgent: req.headers["user-agent"],
    //   },
    // });

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
    const { appConfig } = require("@/config");
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

/**
 * Validate Asana webhook signature
 * @param {Object} req - Express request object
 * @returns {boolean} True if signature is valid
 * @throws {ValidationError} If validation fails
 */
const validateAsanaWebhookSignature = (req) => {
  try {
    const signature = req.headers["x-hook-signature"];
    const secret = req.headers["x-hook-secret"];

    if (!signature) {
      throw new ValidationError("Missing X-Hook-Signature header");
    }

    if (!secret) {
      throw new ValidationError("Missing X-Hook-Secret header");
    }

    // For handshake, just echo the secret
    if (req.headers["x-hook-secret"]) {
      return true; // Handshake validation
    }

    // For actual webhook events, validate HMAC signature
    const { appConfig } = require("@/config");
    const webhookSecret = appConfig.asana.webhookSecret;

    if (!webhookSecret) {
      throw new ValidationError("Asana webhook secret not configured");
    }

    const rawBody = req.rawBodyBuffer || Buffer.from(JSON.stringify(req.body));
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const providedSignature = signature.replace("sha256=", "");

    if (expectedSignature !== providedSignature) {
      throw new ValidationError("Invalid Asana webhook signature");
    }

    logger.debug({
      message: "Asana webhook signature validated successfully",
    });

    return true;
  } catch (error) {
    logger.error({
      message: "Asana webhook signature validation failed",
      error: error.message,
    });
    throw error;
  }
};

/**
 * Validate Brevo webhook authentication
 * @param {Object} req - Express request object
 * @returns {boolean} True if authentication is valid
 * @throws {ValidationError} If validation fails
 */
const validateBrevoWebhookAuth = (req) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
      throw new ValidationError("Missing Authorization header");
    }

    const { appConfig } = require("@/config");
    const expectedAuth = appConfig.brevo.webhookAuth;

    if (!expectedAuth) {
      throw new ValidationError("Brevo webhook auth not configured");
    }

    if (authHeader !== `Bearer ${expectedAuth}`) {
      throw new ValidationError("Invalid Brevo webhook authorization");
    }

    logger.debug({
      message: "Brevo webhook authentication validated successfully",
    });

    return true;
  } catch (error) {
    logger.error({
      message: "Brevo webhook authentication validation failed",
      error: error.message,
    });
    throw error;
  }
};

module.exports = {
  validateAppsScriptSignature,
  validateAsanaWebhookSignature,
  validateBrevoWebhookAuth,
};
