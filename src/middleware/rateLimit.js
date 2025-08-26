const rateLimit = require("express-rate-limit");
const { appConfig } = require("@/config");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("middleware:rateLimit");

// Basic rate limit configuration
const createRateLimit = (
  windowMs,
  max,
  message,
  skipSuccessfulRequests = false
) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: "Rate limit exceeded",
      message,
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (req, res) => {
      logger.warn(
        {
          ip: req.clientIp || req.ip,
          method: req.method,
          url: req.url,
          userAgent: req.userAgent,
        },
        "Rate limit exceeded"
      );

      res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        message,
      });
    },
  });
};

// Rate limit configurations
const rateLimits = {
  // General API rate limit with health check skip
  apiWithHealthSkip: rateLimit({
    windowMs: appConfig.rateLimit.windowMs,
    max: appConfig.rateLimit.maxRequests,
    skip: (req) => {
      return req.url === "/api/healthz" || req.url === "/api/readyz";
    },
    message: {
      success: false,
      error: "Rate limit exceeded",
      message: "Too many requests from this IP, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Strict rate limit for authentication endpoints
  auth: createRateLimit(
    15 * 60 * 1000, // 15 minutes
    5, // 5 attempts
    "Too many authentication attempts, please try again later.",
    false
  ),

  // Webhook rate limit
  webhook: createRateLimit(
    60 * 1000, // 1 minute
    50, // 50 requests
    "Too many webhook requests, please slow down.",
    true
  ),

  // Admin actions rate limit
  admin: createRateLimit(
    60 * 1000, // 1 minute
    20, // 20 requests
    "Too many admin requests, please slow down.",
    false
  ),

  // Upload rate limit
  upload: createRateLimit(
    15 * 60 * 1000, // 15 minutes
    10, // 10 uploads
    "Too many upload attempts, please try again later.",
    false
  ),
};

module.exports = { rateLimits };
