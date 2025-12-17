const cors = require("cors");
const { appConfig } = require("@/config");

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // In development, allow all origins
    if (appConfig.server.nodeEnv === "development") {
      return callback(null, true);
    }

    // In production, only allow specific origins
    const allowedOrigins = [
      appConfig.server.frontendUrl,
      "https://levitate.ng",
      "https://www.levitate.ng",
      "https://app.levitate.ng",
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "X-Correlation-ID",
    "X-Hook-Secret",
    "X-Hook-Signature",
    "x-acting-role", // Allow frontend to pass acting role
  ],
  exposedHeaders: [
    "X-Correlation-ID",
    "X-Response-Time",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
  ],
  maxAge: 86400, // 24 hours
};

const corsMiddleware = cors(corsOptions);

module.exports = { corsMiddleware };
