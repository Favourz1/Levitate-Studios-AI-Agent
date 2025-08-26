const { createLogger } = require("@/utils/logger");

const logger = createLogger("worker:asanaSync");

const asanaSyncProcessor = async (job) => {
  logger.info(
    {
      jobId: job.id,
      data: job.data,
    },
    "Processing Asana sync job (placeholder)"
  );

  // Placeholder implementation
  return {
    projectId: job.data.projectId,
    action: job.data.action,
    success: true,
  };
};

module.exports = {
  asanaSyncProcessor,
};
