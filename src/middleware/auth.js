const jwt = require("jsonwebtoken");
const { appConfig } = require("@/config");
const { UnauthorizedError, ForbiddenError } = require("@/utils/errors");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("middleware:auth");

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    throw new UnauthorizedError("Access token required");
  }

  try {
    const decoded = jwt.verify(token, appConfig.server.jwtSecret);

    req.user = decoded;
    next();
  } catch (error) {
    logger.warn({ token: token.substring(0, 10) + "..." }, "Invalid token");
    throw new UnauthorizedError("Invalid or expired token");
  }
};

// Optional authentication middleware (doesn't throw if no token)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, appConfig.server.jwtSecret);

    req.user = decoded;
  } catch (error) {
    // Silently ignore invalid tokens for optional auth
    logger.debug(
      { token: token.substring(0, 10) + "..." },
      "Invalid optional token"
    );
  }

  next();
};

// Role-based authorization middleware
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const hasRequiredRole = req.user.roles.some((role) =>
      allowedRoles.includes(role)
    );

    if (!hasRequiredRole) {
      throw new ForbiddenError(
        `Requires one of the following roles: ${allowedRoles.join(", ")}`
      );
    }

    next();
  };
};

// Admin role check
const requireAdmin = requireRole(["ADMIN"]);

// Manager or Admin role check
const requireManagerOrAdmin = requireRole(["MANAGER", "ADMIN"]);

// PM, Finance, Manager, or Admin role check
const requireManagementStaff = requireRole([
  "PROJECT_MANAGER",
  "FINANCE_MANAGER",
  "MANAGER",
  "ADMIN",
]);

// Webhook authentication middleware
const authenticateWebhook = (secretHeaderName, expectedSecret) => {
  return (req, res, next) => {
    const providedSecret = req.headers[secretHeaderName.toLowerCase()];

    if (!providedSecret) {
      throw new UnauthorizedError(`Missing ${secretHeaderName} header`);
    }

    // Use provided secret or try to determine from webhook provider
    let secret = expectedSecret;
    if (!secret) {
      // For dynamic secret lookup based on provider
      const provider = req.body?.provider || req.query?.provider;
      if (provider === "brevo") {
        secret = appConfig.brevo.webhookSecret;
      }
      // Add other providers as needed
    }

    if (!secret) {
      throw new UnauthorizedError("Unable to determine webhook secret");
    }

    if (providedSecret !== secret) {
      logger.warn(
        {
          providedSecret: providedSecret.substring(0, 5) + "...",
          secretHeaderName,
        },
        "Invalid webhook secret"
      );
      throw new UnauthorizedError("Invalid webhook secret");
    }

    next();
  };
};

// Action token authentication middleware (for email links)
const authenticateActionToken = (req, res, next) => {
  const token = req.query.t || req.body.token;

  if (!token) {
    throw new UnauthorizedError("Action token required");
  }

  try {
    const decoded = jwt.verify(token, appConfig.server.jwtSecret);

    // Store the decoded token data for use in route handlers
    req.actionData = decoded;

    next();
  } catch (error) {
    console.log("error from authenticateActionToken");
    console.log(error);
    logger.warn(
      { token: token.substring(0, 10) + "...", stack: error.stack },
      "Invalid action token"
    );
    throw new UnauthorizedError("Invalid or expired action token");
  }
};

// HMAC signature verification (for Asana webhooks)
const verifyHmacSignature = (secret, headerName = "x-hook-signature") => {
  return (req, res, next) => {
    const signature = req.headers[headerName];

    if (!signature) {
      throw new UnauthorizedError(`Missing ${headerName} header`);
    }

    const crypto = require("crypto");
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    // Add 'sha256=' prefix if not present
    const formattedExpected = expectedSignature.startsWith("sha256=")
      ? expectedSignature
      : `sha256=${expectedSignature}`;

    if (signature !== formattedExpected) {
      logger.warn(
        {
          providedSignature: signature.substring(0, 10) + "...",
          expectedSignature: formattedExpected.substring(0, 10) + "...",
        },
        "Invalid HMAC signature"
      );
      throw new UnauthorizedError("Invalid signature");
    }

    next();
  };
};

// Create a JWT token (utility function)
const createJwtToken = (payload, expiresIn = "24h") => {
  return jwt.sign(payload, appConfig.server.jwtSecret, { expiresIn });
};

// Create an action token with short expiration
const createActionToken = (payload, expiresIn = "1h") => {
  return jwt.sign(payload, appConfig.server.jwtSecret, { expiresIn });
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireManagerOrAdmin,
  requireManagementStaff,
  authenticateWebhook,
  authenticateActionToken,
  verifyHmacSignature,
  createJwtToken,
  createActionToken,
};
