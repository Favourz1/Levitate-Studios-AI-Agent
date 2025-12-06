const { Router } = require("express");
const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const {
  asyncHandler,
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { ValidationError } = require("@/utils/errors");
const {
  DocumentType,
  DocumentStatus,
  AuditActions,
  SystemActors,
} = require("@/constants");
const { QueueService } = require("@/queues");
const { WorkplanPlannerService } = require("@/services");

const router = Router();
const prisma = getPrismaClient();
const logger = createLogger("routes:workplan");

/**
 * POST /workplan/:documentId/slide/:slideId/regenerate
 * Queue regeneration for a single slide
 */
router.post(
  "/:documentId/slide/:slideId/regenerate",
  asyncHandler(async (req, res) => {
    // TODO: Track who requested to send completion email from worker when done.
    const documentId = parseInt(req.params.documentId, 10);
    const slideId = parseInt(req.params.slideId, 10);
    const reason = req.body?.reason || null;

    if (Number.isNaN(documentId) || Number.isNaN(slideId)) {
      throw new ValidationError("Invalid documentId or slideId");
    }

    // Validate slide & document
    const slide = await prisma.workplanSlide.findUnique({
      where: { id: slideId },
      include: { document: true },
    });

    if (!slide || !slide.document || slide.documentId !== documentId) {
      return sendErrorResponse(
        res,
        new Error("Slide not found for this document"),
        404
      );
    }

    if (slide.document.type !== DocumentType.WORKPLAN) {
      return sendErrorResponse(
        res,
        new Error("Document is not a workplan"),
        400
      );
    }

    // Reset slide statuses to pending & store regeneration reason
    await prisma.workplanSlide.update({
      where: { id: slideId },
      data: {
        researchStatus: "PENDING",
        contentStatus: "PENDING",
        designStatus: "PENDING",
        metadataInfo: {
          ...(slide.metadataInfo || {}),
          regenerationReason: reason,
          regeneratedAt: new Date().toISOString(),
        },
      },
    });

    // Enqueue slide regeneration job
    const job = await QueueService.addSlideRegenerationJob({
      documentId,
      slideId,
      regenerationReason: reason,
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        projectId: slide.document.projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: AuditActions.WORKPLAN_SLIDE_REGENERATION_REQUESTED,
        details: {
          documentId,
          slideId,
          regenerationReason: reason,
          jobId: job?.id || null,
        },
      },
    });

    logger.info(
      { documentId, slideId, reason, jobId: job?.id },
      "Slide regeneration queued"
    );

    // Construct Google Doc URL if possible
    let googleDocUrl = null;
    if (slide.document.driveFileId) {
      googleDocUrl = `https://docs.google.com/document/d/${slide.document.driveFileId}`;
    }

    return sendSuccessResponse(
      res,
      {
        documentId,
        slideId,
        regenerationReason: reason,
        jobId: job?.id || null,
        googleDocUrl,
      },
      "Slide regeneration queued, re-check the document in ~10 mins."
    );
  })
);

/**
 * POST /workplan/:documentId/regenerate
 * Queue regeneration for the entire workplan
 */
router.post(
  "/:documentId/regenerate",
  asyncHandler(async (req, res) => {
    const documentId = parseInt(req.params.documentId, 10);
    const reason = req.body?.reason || null;

    if (Number.isNaN(documentId)) {
      throw new ValidationError("Invalid documentId");
    }

    // Validate document
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { workplanSlides: true },
    });

    if (!document || document.type !== DocumentType.WORKPLAN) {
      return sendErrorResponse(
        res,
        new Error("Workplan document not found"),
        404
      );
    }

    // Reset document + slides
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.DRAFT,
        metadataInfo: {
          ...(document.metadataInfo || {}),
          regenerationReason: reason,
          regeneratedAt: new Date().toISOString(),
        },
      },
    });

    await prisma.workplanSlide.updateMany({
      where: { documentId },
      data: {
        researchStatus: "PENDING",
        contentStatus: "PENDING",
        designStatus: "PENDING",
      },
    });

    // Get service type (cached) and enqueue regeneration
    const serviceType = await WorkplanPlannerService.getServiceType(
      document.projectId
    );

    const job = await QueueService.addWorkplanGenerationJob(
      {
        projectId: document.projectId,
        serviceType,
        documentId,
        isRegeneration: true,
        regenerationReason: reason,
      },
      5
    );

    // Audit log
    await prisma.auditLog.create({
      data: {
        projectId: document.projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: AuditActions.WORKPLAN_REGENERATION_REQUESTED,
        details: {
          documentId,
          regenerationReason: reason,
          serviceType,
          jobId: job?.id || null,
        },
      },
    });

    logger.info(
      {
        documentId,
        projectId: document.projectId,
        reason,
        serviceType,
        jobId: job?.id,
      },
      "Workplan regeneration queued"
    );

    return sendSuccessResponse(
      res,
      {
        documentId,
        projectId: document.projectId,
        status: DocumentStatus.DRAFT,
        regenerationReason: reason,
        jobId: job?.id || null,
      },
      "Workplan regeneration queued"
    );
  })
);

module.exports = { workplanRouter: router };
