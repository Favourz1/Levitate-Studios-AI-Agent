const { createLogger } = require("@/utils/logger");

const logger = createLogger("worker:emailIntent");

const emailIntentProcessor = async (job) => {
  logger.info(
    {
      jobId: job.id,
      data: job.data,
    },
    "Processing email intent job (placeholder)"
  );

  // Placeholder implementation
  return {
    emailId: job.data.emailId,
    intent: "NONE",
    confidence: 0.5,
  };
};

module.exports = {
  emailIntentProcessor,
};
