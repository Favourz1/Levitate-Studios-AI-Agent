const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const { appConfig } = require("@/config");
const { DocumentType } = require("@/constants");
const {
  createLogger,
  logJobStart,
  logJobComplete,
  logJobFailed,
} = require("@/utils/logger");

const logger = createLogger("queue");

// Redis connection
const redis = new IORedis(appConfig.redis.url, {
  maxRetriesPerRequest: null,
  // maxRetriesPerRequest: appConfig.redis.maxRetriesPerRequest,
  retryDelayOnFailover: appConfig.redis.retryDelayOnFailover,
  lazyConnect: true,
});

// Queue names
const QUEUE_NAMES = {
  DOC_GENERATION: "doc-generation",
  EMAIL_INTENT: "email-intent",
  FEEDBACK_INTENT: "feedback-intent",
  ASANA_SYNC: "asana-sync",
  ASANA_PROJECT_INIT: "asana-project-init",
  QUOTE_GENERATION: "quote-generation",
  NOTIFICATIONS: "notifications",
  SNAPSHOT_SYNC: "snapshot-sync",
  WORKPLAN_GENERATION: "workplan-generation",
};

// Queue instances
const queues = {
  docGeneration: new Queue(QUEUE_NAMES.DOC_GENERATION, { connection: redis }),
  emailIntent: new Queue(QUEUE_NAMES.EMAIL_INTENT, { connection: redis }),
  feedbackIntent: new Queue(QUEUE_NAMES.FEEDBACK_INTENT, { connection: redis }),
  asanaSync: new Queue(QUEUE_NAMES.ASANA_SYNC, { connection: redis }),
  asanaProjectInit: new Queue(QUEUE_NAMES.ASANA_PROJECT_INIT, {
    connection: redis,
  }),
  quoteGeneration: new Queue(QUEUE_NAMES.QUOTE_GENERATION, {
    connection: redis,
  }),
  notifications: new Queue(QUEUE_NAMES.NOTIFICATIONS, { connection: redis }),
  snapshotSync: new Queue(QUEUE_NAMES.SNAPSHOT_SYNC, { connection: redis }),
  workplanGeneration: new Queue(QUEUE_NAMES.WORKPLAN_GENERATION, {
    connection: redis,
  }),
};

// Default job options
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: 10,
  removeOnFail: 20,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
};

// Queue service class
class QueueService {
  // Document generation jobs
  static async addDocumentGenerationJob(data, priority = 0) {
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority,
      jobId: data.dedupeKey,
    };

    return queues.docGeneration.add("generate-document", data, jobOptions);
  }

  // Brand origin document generation job with specific dedupe key
  static async addBrandOriginGenerationJob(data, priority = 1) {
    // Create different dedupe keys for initial generation vs regeneration
    const dedupeKey = data.feedbackContext?.isRegeneration
      ? `project:${data.projectId}:brand_origin:regenerate:${data.feedbackContext.emailId}`
      : `project:${data.projectId}:brand_origin:generate`;

    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority: data.feedbackContext?.isRegeneration ? priority + 1 : priority, // Higher priority for regeneration
      jobId: dedupeKey, // Ensure idempotency with dedupe key
    };

    const jobData = {
      ...data,
      dedupeKey,
      documentType: DocumentType.BRAND_ORIGIN,
    };

    return queues.docGeneration.add(
      "generate-brand-origin",
      jobData,
      jobOptions
    );
  }

  // Email parsing jobs
  static async addEmailParseJob(data, priority = 0) {
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority,
      jobId: data.dedupeKey,
    };

    return queues.emailIntent.add("parse-email", data, jobOptions);
  }

  // Feedback intent detection jobs (for UI regeneration)
  static async addFeedbackIntentJob(data, priority = 5) {
    const dedupeKey =
      data.dedupeKey ||
      `document:${data.documentId}:feedback-intent:${Date.now()}`;
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority, // High priority for regeneration
      jobId: dedupeKey,
    };

    const jobData = {
      ...data,
      dedupeKey,
    };

    return queues.feedbackIntent.add(
      "detect-feedback-intent",
      jobData,
      jobOptions
    );
  }

  // Asana sync jobs
  static async addAsanaSyncJob(data, priority = 0) {
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority,
      jobId: data.dedupeKey,
    };

    return queues.asanaSync.add("sync-asana", data, jobOptions);
  }

  // Quote generation jobs
  static async addQuoteGenerationJob(data, priority = 0) {
    const dedupeKey =
      data.dedupeKey || `project:${data.projectId}:quote:generate`;
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority,
      jobId: dedupeKey,
    };

    const jobData = {
      ...data,
      dedupeKey,
    };

    return queues.quoteGeneration.add("generate-quote", jobData, jobOptions);
  }

  // Quote update jobs (for feedback-based updates)
  static async addQuoteUpdateJob(data, priority = 2) {
    const dedupeKey =
      data.dedupeKey ||
      `project:${data.projectId}:quote:update:${data.documentId}:${
        data.feedbackContext?.emailId || Date.now()
      }`;
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority, // Higher priority for updates (client feedback)
      jobId: dedupeKey,
    };

    const jobData = {
      ...data,
      dedupeKey,
    };

    return queues.quoteGeneration.add("update-quote", jobData, jobOptions);
  }

  // Asana project initialization jobs
  static async addAsanaProjectInitJob(data, priority = 0) {
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority,
      jobId: data.dedupeKey,
    };

    return queues.asanaProjectInit.add("init-project", data, jobOptions);
  }

  // Notification jobs
  static async addNotificationJob(data, priority = 0) {
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority,
      jobId: data.dedupeKey,
    };

    return queues.notifications.add("send-notification", data, jobOptions);
  }

  // Snapshot sync jobs
  static async addSnapshotSyncJob(data, priority = 0) {
    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority,
      jobId: data.dedupeKey,
    };

    return queues.snapshotSync.add("sync-snapshot", data, jobOptions);
  }

  // Workplan generation jobs
  static async addWorkplanGenerationJob(data, priority = 0) {
    // Create dedupe key based on whether it's a regeneration or initial generation
    const dedupeKey = data.isRegeneration
      ? `workplan:${data.documentId}:regenerate`
      : `workplan:${data.projectId}:${data.serviceType}`;

    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority: data.isRegeneration ? priority + 1 : priority, // Higher priority for regeneration
      jobId: dedupeKey, // Ensure idempotency with dedupe key
    };

    const jobData = {
      ...data,
      dedupeKey,
    };

    return queues.workplanGeneration.add(
      "generate-workplan",
      jobData,
      jobOptions
    );
  }

  // Slide regeneration jobs
  static async addSlideRegenerationJob(data, priority = 0) {
    const dedupeKey = `workplan-slide:${data.documentId}:${data.slideId}:regenerate`;

    const jobOptions = {
      ...DEFAULT_JOB_OPTIONS,
      priority: priority + 1, // Higher priority for regenerations
      jobId: dedupeKey,
    };

    const jobData = {
      ...data,
      dedupeKey,
    };

    return queues.workplanGeneration.add(
      "regenerate-slide",
      jobData,
      jobOptions
    );
  }

  // Get job by ID
  static async getJob(queueName, jobId) {
    return queues[queueName].getJob(jobId);
  }

  // Get queue stats
  static async getQueueStats(queueName) {
    const queue = queues[queueName];
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  // Pause queue
  static async pauseQueue(queueName) {
    await queues[queueName].pause();
    logger.info({ queueName }, "Queue paused");
  }

  // Resume queue
  static async resumeQueue(queueName) {
    await queues[queueName].resume();
    logger.info({ queueName }, "Queue resumed");
  }

  // Clean queue
  static async cleanQueue(queueName, grace, status) {
    const queue = queues[queueName];
    const cleaned = await queue.clean(grace, status);
    logger.info({ queueName, status, cleaned }, "Queue cleaned");
    return cleaned.length;
  }

  // Drain queue (remove all jobs)
  static async drainQueue(queueName) {
    await queues[queueName].drain();
    logger.info({ queueName }, "Queue drained");
  }
}

// Worker factory function
const createWorker = (queueName, processor, concurrency = 1) => {
  const worker = new Worker(
    queueName,
    async (job) => {
      const startTime = Date.now();
      logJobStart(logger, queueName, job.id, job.data);

      try {
        const result = await processor(job);
        const duration = Date.now() - startTime;
        logJobComplete(logger, queueName, job.id, duration, result);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logJobFailed(logger, queueName, job.id, error, duration);
        throw error;
      }
    },
    {
      connection: redis,
      concurrency,
      removeOnComplete: 10,
      removeOnFail: 30,
    }
  );

  // Add error handling
  worker.on("error", (error) => {
    logger.error({ queueName, error }, "Worker error");
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ queueName, jobId }, "Job stalled");
  });

  return worker;
};

// Health check function
const checkQueuesHealth = async () => {
  const health = {
    redis: false,
    queues: {},
  };

  try {
    await redis.ping();
    health.redis = true;
  } catch (error) {
    logger.error("Redis health check failed:", error);
  }

  for (const [name, queue] of Object.entries(queues)) {
    try {
      await queue.getWaiting();
      health.queues[name] = true;
    } catch (error) {
      logger.error(`Queue ${name} health check failed:`, error);
      health.queues[name] = false;
    }
  }

  return health;
};

// Graceful shutdown
const shutdownQueues = async () => {
  logger.info("Shutting down queues...");

  // Close all queues
  await Promise.all(Object.values(queues).map((queue) => queue.close()));

  // Close Redis connection
  await redis.quit();

  logger.info("Queues shutdown complete");
};

module.exports = {
  redis,
  QUEUE_NAMES,
  queues,
  QueueService,
  createWorker,
  checkQueuesHealth,
  shutdownQueues,
};
