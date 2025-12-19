const express = require("express");
const router = express.Router();
const { asyncHandler } = require("@/middleware/errorHandler");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { StatusCodes } = require("http-status-codes");
const { getPrismaClient } = require("@/database");
const { requireAuthForUI } = require("@/middleware/auth");
const { requirePermission } = require("@/utils/permissions");
const { queues, QUEUE_NAMES } = require("@/queues");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/ops/queues
 * Get queue status using queue monitoring (not job_runs table)
 * Recopy pattern from src/monitoring/queueMonitor.js
 */
router.get(
  "/queues",
  requireAuthForUI,
  requirePermission("ops", "view"),
  asyncHandler(async (req, res) => {
    // This gets real-time queue stats from BullMQ/Redis
    // Recopy how it's done from src/monitoring/queueMonitor.js
    const queueStats = [];

    for (const [name, queue] of Object.entries(queues)) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        queueStats.push({
          name: name,
          waiting: waiting || 0,
          active: active || 0,
          completed: completed || 0,
          failed: failed || 0,
          delayed: delayed || 0,
        });
      } catch (error) {
        // If a queue fails, log error but continue with other queues
        console.error(`Failed to get stats for queue ${name}:`, error);
        queueStats.push({
          name: name,
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        });
      }
    }

    return sendSuccessResponse(
      res,
      { queues: queueStats },
      "Queue status retrieved successfully",
      StatusCodes.OK
    );
  })
);

/**
 * GET /api/v1/ui/ops/jobs
 * List active jobs from queue monitoring (not job_runs table)
 * Recopy pattern from src/monitoring/queueMonitor.js
 */
router.get(
  "/jobs",
  requireAuthForUI,
  requirePermission("ops", "view"),
  asyncHandler(async (req, res) => {
    const { status, limit = 50 } = req.query;
    const limitNum = parseInt(limit, 10);

    // Use queue monitoring to get active jobs
    // Recopy how it's done from src/monitoring/queueMonitor.js
    const allJobs = [];

    for (const [queueName, queue] of Object.entries(queues)) {
      try {
        let jobs = [];

        if (status === "waiting") {
          jobs = await queue.getWaiting(0, limitNum);
        } else if (status === "active") {
          jobs = await queue.getActive(0, limitNum);
        } else if (status === "completed") {
          jobs = await queue.getCompleted(0, limitNum);
        } else if (status === "failed") {
          jobs = await queue.getFailed(0, limitNum);
        } else if (status === "delayed") {
          jobs = await queue.getDelayed(0, limitNum);
        } else {
          // Get all statuses if no filter
          const [waiting, active, completed, failed, delayed] =
            await Promise.all([
              queue.getWaiting(0, limitNum),
              queue.getActive(0, limitNum),
              queue.getCompleted(0, limitNum),
              queue.getFailed(0, limitNum),
              queue.getDelayed(0, limitNum),
            ]);
          jobs = [
            ...waiting,
            ...active,
            ...completed,
            ...failed,
            ...delayed,
          ].slice(0, limitNum);
        }

        // Transform jobs to include queue name and status
        for (const job of jobs) {
          const jobState = await job.getState();
          allJobs.push({
            id: job.id,
            name: job.name,
            queueName: queueName,
            status: jobState,
            data: job.data,
            attemptsMade: job.attemptsMade,
            failedReason: job.failedReason,
            createdAt: new Date(job.timestamp).toISOString(),
            processedAt: job.processedOn
              ? new Date(job.processedOn).toISOString()
              : null,
            finishedAt: job.finishedOn
              ? new Date(job.finishedOn).toISOString()
              : null,
          });
        }
      } catch (error) {
        // If a queue fails, log error but continue with other queues
        console.error(`Failed to get jobs for queue ${queueName}:`, error);
      }
    }

    // Sort by createdAt descending and limit
    allJobs.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    const limitedJobs = allJobs.slice(0, limitNum);

    return sendSuccessResponse(
      res,
      { jobs: limitedJobs },
      "Active jobs retrieved successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/ops/jobs/:queueName/:jobId/retry
 * Retry a failed job from queue
 * Note: Uses queue name and job ID from queue system, not job_runs table
 */
router.post(
  "/jobs/:queueName/:jobId/retry",
  requireAuthForUI,
  requirePermission("ops", "retryJobs"),
  asyncHandler(async (req, res) => {
    const { queueName, jobId } = req.params;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    // Validate queue exists
    if (!queues[queueName]) {
      return sendErrorResponse(
        res,
        `Queue not found: ${queueName}`,
        StatusCodes.NOT_FOUND
      );
    }

    const queue = queues[queueName];

    // Get job from queue
    const job = await queue.getJob(jobId);
    if (!job) {
      return sendErrorResponse(
        res,
        `Job not found: ${jobId} in queue ${queueName}`,
        StatusCodes.NOT_FOUND
      );
    }

    // Validate job state is 'failed' before retry
    const state = await job.getState();
    if (state !== "failed") {
      return sendErrorResponse(
        res,
        `Cannot retry job in ${state} state. Only failed jobs can be retried.`,
        StatusCodes.BAD_REQUEST
      );
    }

    // Retry the job
    await job.retry();

    // Log audit
    await prisma.auditLog.create({
      data: {
        actor: userId.toString(),
        actingRole,
        action: "RETRY_JOB",
        details: {
          queueName,
          jobId,
          jobName: job.name,
          name: req.user.name,
        },
      },
    });

    return sendSuccessResponse(
      res,
      { message: "Job queued for retry" },
      "Job retry initiated successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
