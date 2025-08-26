const pino = require("pino");
const { appConfig } = require("@/config");
// Create logger instance
const logger = pino({
  level: appConfig.logLevel,
  transport:
    appConfig.server.nodeEnv === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: true,
            ignore: "pid,hostname",
          },
        }
      : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  base: {
    env: process.env.NODE_ENV,
  },
});

// Create child loggers for different modules
const createLogger = (module) => {
  return logger.child({ module });
};

// Helper functions for structured logging
const logError = (logger, error, context) => {
  logger.error(
    {
      err: error,
      context,
      stack: error.stack,
    },
    error.message
  );
};

const logJobStart = (logger, jobName, jobId, data) => {
  logger.info(
    {
      jobName,
      jobId,
      data,
      event: "job_start",
    },
    `Job ${jobName} started`
  );
};

const logJobComplete = (logger, jobName, jobId, duration, result) => {
  logger.info(
    {
      jobName,
      jobId,
      duration,
      result,
      event: "job_complete",
    },
    `Job ${jobName} completed`
  );
};

const logJobFailed = (logger, jobName, jobId, error, duration) => {
  logger.error(
    {
      jobName,
      jobId,
      duration,
      err: error,
      event: "job_failed",
    },
    `Job ${jobName} failed`
  );
};

const logAPIRequest = (logger, method, url, userId, correlationId) => {
  logger.info(
    {
      method,
      url,
      userId,
      correlationId,
      event: "api_request",
    },
    `${method} ${url}`
  );
};

const logAPIResponse = (
  logger,
  method,
  url,
  statusCode,
  duration,
  correlationId
) => {
  logger.info(
    {
      method,
      url,
      statusCode,
      duration,
      correlationId,
      event: "api_response",
    },
    `${method} ${url} - ${statusCode}`
  );
};

const logLLMCall = (logger, model, traceId, tokenCount, cost) => {
  logger.info(
    {
      model,
      traceId,
      tokenCount,
      cost,
      event: "llm_call",
    },
    `LLM call to ${model}`
  );
};

const logIntegrationCall = (
  logger,
  integration,
  action,
  success,
  duration,
  error
) => {
  const level = success ? "info" : "error";
  logger[level](
    {
      integration,
      action,
      success,
      duration,
      err: error,
      event: "integration_call",
    },
    `${integration} ${action} - ${success ? "success" : "failed"}`
  );
};

module.exports = {
  createLogger,
  logger,
  logError,
  logJobStart,
  logJobComplete,
  logJobFailed,
  logAPIRequest,
  logAPIResponse,
  logLLMCall,
  logIntegrationCall,
};
