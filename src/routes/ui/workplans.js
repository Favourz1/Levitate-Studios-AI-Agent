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
const { QueueService } = require("@/queues");
const { WorkplanPlannerService } = require("@/services/workplanPlannerService");
const {
  DocumentType,
  DocumentStatus,
  SlideStatus,
  AuditActions,
} = require("@/constants");
const { generateUuid } = require("@/utils");

const prisma = getPrismaClient();

/**
 * POST /api/v1/ui/workplans/:documentId/regenerate
 * Regenerate entire workplan
 */
router.post(
  "/:documentId/regenerate",
  requireAuthForUI,
  requirePermission("workplans", "regenerate"),
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const { feedback, reason } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!feedback && !reason) {
      return sendErrorResponse(
        res,
        "Feedback or reason is required for regeneration",
        StatusCodes.BAD_REQUEST
      );
    }

    const document = await prisma.document.findUnique({
      where: { id: parseInt(documentId, 10) },
      include: { project: true },
    });

    if (!document) {
      return sendErrorResponse(
        res,
        "Document not found",
        StatusCodes.NOT_FOUND
      );
    }

    if (document.type !== DocumentType.WORKPLAN) {
      return sendErrorResponse(
        res,
        "Document is not a workplan",
        StatusCodes.BAD_REQUEST
      );
    }

    // Status validation: Cannot regenerate if in RESEARCHING, GENERATING, or DRAFT
    const invalidStatuses = [
      DocumentStatus.RESEARCHING,
      DocumentStatus.GENERATING,
      DocumentStatus.DRAFT,
    ];
    if (invalidStatuses.includes(document.status)) {
      return sendErrorResponse(
        res,
        `Cannot regenerate workplan in ${document.status} status`,
        StatusCodes.BAD_REQUEST
      );
    }

    const feedbackText = feedback || reason;
    const correlationId = generateUuid();

    // Reset document and slides statuses (same pattern as src/routes/workplan.js)
    await prisma.document.update({
      where: { id: parseInt(documentId, 10) },
      data: {
        status: DocumentStatus.DRAFT,
        metadataInfo: {
          ...(document.metadataInfo || {}),
          regenerationReason: feedbackText,
          regeneratedAt: new Date().toISOString(),
        },
      },
    });

    await prisma.workplanSlide.updateMany({
      where: { documentId: parseInt(documentId, 10) },
      data: {
        researchStatus: SlideStatus.PENDING,
        contentStatus: SlideStatus.PENDING,
        designStatus: SlideStatus.PENDING,
      },
    });

    // Get service type (uses cache if available)
    const serviceType = await WorkplanPlannerService.getServiceType(
      document.projectId
    );

    // Enqueue workplan regeneration job (same pattern as src/routes/workplan.js)
    const job = await QueueService.addWorkplanGenerationJob(
      {
        projectId: document.projectId,
        serviceType: serviceType,
        documentId: parseInt(documentId, 10),
        isRegeneration: true,
        regenerationReason: feedbackText,
      },
      5 // High priority
    );

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: document.projectId,
        actor: userId.toString(),
        actingRole,

        action: AuditActions.WORKPLAN_REGENERATION_REQUESTED,
        details: {
          documentId: parseInt(documentId, 10),
          reason: feedbackText,
          jobId: job?.id || null,
          requestedBy: userId,
          actingRole: actingRole,
          source: "UI",
        },
        at: new Date(),
      },
    });

    // Construct Google Doc URL if available
    let googleDocUrl = null;
    if (document.driveFileId) {
      googleDocUrl = `https://docs.google.com/document/d/${document.driveFileId}`;
    }

    return sendSuccessResponse(
      res,
      {
        documentId: parseInt(documentId, 10),
        regenerationReason: feedbackText,
        jobId: job?.id || null,
        googleDocUrl: googleDocUrl,
      },
      "Workplan regeneration queued successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/workplans/:documentId/slides/:slideId/regenerate
 * Regenerate a single workplan slide
 */
router.post(
  "/:documentId/slides/:slideId/regenerate",
  requireAuthForUI,
  requirePermission("workplans", "regenerate"),
  asyncHandler(async (req, res) => {
    const { documentId, slideId } = req.params;
    const { feedback, reason } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!feedback && !reason) {
      return sendErrorResponse(
        res,
        "Feedback or reason is required for regeneration",
        StatusCodes.BAD_REQUEST
      );
    }

    const slide = await prisma.workplanSlide.findUnique({
      where: { id: parseInt(slideId, 10) },
      include: { document: true },
    });

    if (!slide) {
      return sendErrorResponse(res, "Slide not found", StatusCodes.NOT_FOUND);
    }

    if (slide.documentId !== parseInt(documentId, 10)) {
      return sendErrorResponse(
        res,
        "Slide does not belong to this workplan",
        StatusCodes.BAD_REQUEST
      );
    }

    // Status validation for slide: Cannot regenerate if in RESEARCHING or GENERATING
    // Note: SlideStatus doesn't have DRAFT, but we check RESEARCHING and GENERATING
    const invalidStatuses = [
      SlideStatus.RESEARCHING,
      SlideStatus.GENERATING,
    ];
    if (
      invalidStatuses.includes(slide.researchStatus) ||
      invalidStatuses.includes(slide.contentStatus) ||
      invalidStatuses.includes(slide.designStatus)
    ) {
      return sendErrorResponse(
        res,
        "Cannot regenerate slide while it is being researched, generated, or drafted",
        StatusCodes.BAD_REQUEST
      );
    }

    const feedbackText = feedback || reason;
    const correlationId = generateUuid();

    // Reset slide statuses and store regeneration reason (same pattern as src/routes/workplan.js)
    await prisma.workplanSlide.update({
      where: { id: parseInt(slideId, 10) },
      data: {
        researchStatus: SlideStatus.PENDING,
        contentStatus: SlideStatus.PENDING,
        designStatus: SlideStatus.PENDING,
        metadataInfo: {
          ...(slide.metadataInfo || {}),
          regenerationReason: feedbackText,
          regeneratedAt: new Date().toISOString(),
        },
      },
    });

    // Enqueue slide regeneration job (same pattern as src/routes/workplan.js)
    const job = await QueueService.addSlideRegenerationJob({
      documentId: parseInt(documentId, 10),
      slideId: parseInt(slideId, 10),
      regenerationReason: feedbackText,
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: slide.document.projectId,
        actor: userId.toString(),
        actingRole,

        action: AuditActions.WORKPLAN_SLIDE_REGENERATION_REQUESTED,
        details: {
          documentId: parseInt(documentId, 10),
          slideId: parseInt(slideId, 10),
          slideType: slide.slideType,
          regenerationReason: feedbackText,
          jobId: job?.id || null,
          requestedBy: userId,
          actingRole: actingRole,
          source: "UI",
        },
        at: new Date(),
      },
    });

    // Construct Google Doc URL if available
    let googleDocUrl = null;
    if (slide.document.driveFileId) {
      googleDocUrl = `https://docs.google.com/document/d/${slide.document.driveFileId}`;
    }

    return sendSuccessResponse(
      res,
      {
        documentId: parseInt(documentId, 10),
        slideId: parseInt(slideId, 10),
        regenerationReason: feedbackText,
        jobId: job?.id || null,
        googleDocUrl: googleDocUrl,
      },
      "Slide regeneration queued successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
