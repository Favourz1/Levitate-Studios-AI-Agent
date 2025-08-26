const { createLogger } = require("@/utils/logger");

const logger = createLogger("worker:notifications");

const notificationProcessor = async (job) => {
  logger.info(
    {
      jobId: job.id,
      data: job.data,
    },
    "Processing notification job (placeholder)"
  );

  // Placeholder implementation
  return {
    type: job.data.type,
    recipients: job.data.recipients,
    success: true,
  };
};

module.exports = {
  notificationProcessor,
};
