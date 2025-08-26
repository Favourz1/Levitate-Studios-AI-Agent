const { createLogger } = require("@/utils/logger");

const logger = createLogger("worker:snapshotSync");

const snapshotSyncProcessor = async (job) => {
  logger.info(
    {
      jobId: job.id,
      data: job.data,
    },
    "Processing snapshot sync job (placeholder)"
  );

  // Placeholder implementation
  return {
    projectId: job.data.projectId,
    success: true,
  };
};

module.exports = {
  snapshotSyncProcessor,
};
