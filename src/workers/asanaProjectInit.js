const { createLogger } = require("@/utils/logger");

const logger = createLogger("worker:asanaProjectInit");

const asanaProjectInitProcessor = async (job) => {
  logger.info(
    {
      jobId: job.id,
      data: job.data,
    },
    "Processing Asana project init job (placeholder)"
  );

  // Placeholder implementation
  return {
    projectId: job.data.projectId,
    asanaProjectGid: "placeholder-gid",
    success: true,
  };
};

module.exports = {
  asanaProjectInitProcessor,
};
