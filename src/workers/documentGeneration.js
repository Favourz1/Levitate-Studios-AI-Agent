const { createLogger } = require("@/utils/logger");

const logger = createLogger("worker:documentGeneration");

const documentGenerationProcessor = async (job) => {
  logger.info(
    {
      jobId: job.id,
      data: job.data,
    },
    "Processing document generation job (placeholder)"
  );

  // Placeholder implementation
  return {
    documentId: 1,
    googleDocId: "placeholder-doc-id",
    revisionId: 1,
  };
};

module.exports = {
  documentGenerationProcessor,
};
