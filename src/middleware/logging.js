const { v4: uuidv4 } = require("uuid");
const {
  createLogger,
  logAPIRequest,
  logAPIResponse,
} = require("@/utils/logger");

const logger = createLogger("middleware:logging");

// Request logging middleware
const requestLogger = (req, res, next) => {
  // Generate correlation ID for request tracking
  const correlationId = req.headers["x-correlation-id"] || uuidv4();
  req.correlationId = correlationId;

  // Set correlation ID in response headers
  res.setHeader("X-Correlation-ID", correlationId);

  const startTime = Date.now();
  const userId = req.user?.id;

  // Log request
  logAPIRequest(logger, req.method, req.url, userId, correlationId);

  // Capture original res.json to log response
  const originalJson = res.json;
  res.json = function (body) {
    const duration = Date.now() - startTime;

    // Log response
    logAPIResponse(
      logger,
      req.method,
      req.url,
      res.statusCode,
      duration,
      correlationId
    );

    // Log response body in development (be careful with sensitive data)
    if (process.env.NODE_ENV === "development" && res.statusCode >= 400) {
      logger.debug(
        {
          correlationId,
          statusCode: res.statusCode,
          responseBody: body,
        },
        "Error response body"
      );
    }

    return originalJson.call(this, body);
  };

  next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Remove sensitive headers
  res.removeHeader("X-Powered-By");

  // Add security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content Security Policy (adjust based on your needs)
  // res.setHeader(
  //   "Content-Security-Policy",
  //   "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https:;"
  // );

  next();
};

// Skip health check logging middleware
const skipHealthCheckLogging = (req, res, next) => {
  if (req.url === "/api/healthz" || req.url === "/api/readyz") {
    req.skipLogging = true;
  }
  next();
};

// Request sanitizer middleware
const requestSanitizer = (req, res, next) => {
  // Basic sanitization - remove null bytes and normalize strings
  if (req.body && typeof req.body === "object") {
    // eslint-disable-next-line no-control-regex
    req.body = JSON.parse(JSON.stringify(req.body).replace(/\u0000/g, ""));
  }
  next();
};

// Request timing middleware
const requestTiming = (req, res, next) => {
  req.startTime = Date.now();
  res.setHeader("X-Response-Time", "0ms");

  const originalSend = res.send;
  res.send = function (body) {
    const duration = Date.now() - req.startTime;
    res.setHeader("X-Response-Time", `${duration}ms`);
    return originalSend.call(this, body);
  };

  next();
};

// IP tracker middleware
const ipTracker = (req, res, next) => {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = forwarded
    ? forwarded.split(",")[0].trim()
    : req.connection.remoteAddress;
  req.clientIp = ip;
  next();
};

// User agent logger middleware
const userAgentLogger = (req, res, next) => {
  req.userAgent = req.headers["user-agent"] || "unknown";
  next();
};

module.exports = {
  requestLogger,
  securityHeaders,
  skipHealthCheckLogging,
  requestSanitizer,
  requestTiming,
  ipTracker,
  userAgentLogger,
};
