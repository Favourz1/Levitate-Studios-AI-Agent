const express = require("express");
const router = express.Router();
const { asyncHandler } = require("@/middleware/errorHandler");
const { sendSuccessResponse } = require("@/middleware/errorHandler");
const { StatusCodes } = require("http-status-codes");
const { getPrismaClient } = require("@/database");
const { requireAuthForUI } = require("@/middleware/auth");
const { DocumentType } = require("@/constants");
const { queues } = require("@/queues");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/dashboard/metrics
 * Get dashboard metrics
 */
router.get(
  "/metrics",
  requireAuthForUI,
  asyncHandler(async (req, res) => {
    // Get counts in parallel
    const [
      formsSubmitted,
      brandOrigins,
      quotes,
      workplans,
      pendingApprovals,
      asanaProjects,
      rejectedProjects,
    ] = await Promise.all([
      prisma.questionnaireResponse.count(),
      prisma.document.count({ where: { type: DocumentType.BRAND_ORIGIN } }),
      prisma.document.count({ where: { type: DocumentType.QUOTE } }),
      prisma.document.count({ where: { type: DocumentType.WORKPLAN } }),
      prisma.document.count({
        where: {
          status: { in: ["PM_REVIEW", "FINANCE_MANAGER_REVIEW"] },
        },
      }),
      prisma.project.count({ where: { asanaProjectGid: { not: null } } }),
      prisma.project.count({ where: { phase: "REJECTED" } }),
    ]);

    // Get active jobs count using queue monitoring (not job_runs table)
    // Recopy pattern from src/monitoring/queueMonitor.js
    let activeJobs = 0;
    try {
      const queueStats = [];
      for (const [name, queue] of Object.entries(queues)) {
        const [waiting, active] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
        ]);
        queueStats.push({
          name,
          waiting,
          active,
        });
        activeJobs += (waiting || 0) + (active || 0);
      }
    } catch (error) {
      // If queue monitoring fails, set activeJobs to 0
      // Log error but don't fail the entire request
      console.error("Failed to get queue stats:", error);
      activeJobs = 0;
    }

    return sendSuccessResponse(
      res,
      {
        formsSubmitted,
        brandOrigins,
        quotes,
        workplans,
        pendingApprovals,
        activeJobs,
        asanaProjects,
        rejectedProjects,
      },
      "Dashboard metrics retrieved successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;

