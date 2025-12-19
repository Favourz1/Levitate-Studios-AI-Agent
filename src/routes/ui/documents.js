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
const { requirePermission, hasPermission } = require("@/utils/permissions");
const { DocumentSendingService } = require("@/services/documentSendingService");
const { QueueService, queues, QUEUE_NAMES } = require("@/queues");
const { createLogger } = require("@/utils/logger");
const { DocumentType, DocumentStatus, AuditActions } = require("@/constants");
const { generateUuid } = require("@/utils");
const { divideAndRoundUp } = require("@/utils/pagination");
const { loadRoleOverrides } = require("@/utils/permissions");

const prisma = getPrismaClient();
const logger = createLogger("route:documents");

/**
 * GET /api/v1/ui/documents
 * List documents with optional filters (type, status, search, projectId) and pagination
 * Permission rules:
 *  - type=QUOTE or QUOTE_VARIANT: requires quotes.view
 *  - type=WORKPLAN: requires workplans.view
 *  - otherwise: requires documents.view
 */
router.get(
  "/",
  requireAuthForUI,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, type, status, search, projectId } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const actingRole = req.actingRole;
    const roleOverrides = await loadRoleOverrides();

    // Check permissions for different document categories
    const canViewQuotes = hasPermission(
      actingRole,
      "quotes",
      "view",
      roleOverrides
    );
    const canViewWorkplans = hasPermission(
      actingRole,
      "workplans",
      "view",
      roleOverrides
    );
    const canViewOtherDocs = hasPermission(
      actingRole,
      "documents",
      "view",
      roleOverrides
    );

    // When type filter is specified, enforce strict permission check (V1 behavior)
    if (type) {
      let permissionCategory = "documents";
      if (type === DocumentType.QUOTE || type === DocumentType.QUOTE_VARIANT) {
        permissionCategory = "quotes";
      } else if (type === DocumentType.WORKPLAN) {
        permissionCategory = "workplans";
      }

      if (
        !hasPermission(actingRole, permissionCategory, "view", roleOverrides)
      ) {
        return sendErrorResponse(
          res,
          `Permission denied: ${permissionCategory}.view`,
          StatusCodes.FORBIDDEN
        );
      }
    }

    // Build base WHERE clause
    const where = {
      ...(status && { status }),
      ...(projectId && { projectId: parseInt(projectId, 10) }),
      ...(search && {
        OR: [
          { erpQuoteId: { contains: search, mode: "insensitive" } },
          {
            project: {
              name: { contains: search, mode: "insensitive" },
            },
          },
          { metadataInfo: { path: ["title"], string_contains: search } },
        ],
      }),
    };

    // Add type filtering based on permissions
    // This is the KEY optimization: filter at DB level, not in memory
    if (type) {
      // Explicit type filter - already permission-checked above
      where.type = type;
    } else if (projectId) {
      // ProjectId without type filter: build type restrictions based on permissions
      const allowedTypes = [];

      if (canViewQuotes) {
        allowedTypes.push(DocumentType.QUOTE, DocumentType.QUOTE_VARIANT);
      }
      if (canViewWorkplans) {
        allowedTypes.push(DocumentType.WORKPLAN);
      }
      if (canViewOtherDocs) {
        // Add all other document types
        // Assuming you have a list of all document types
        const restrictedTypes = [
          DocumentType.QUOTE,
          DocumentType.QUOTE_VARIANT,
          DocumentType.WORKPLAN,
        ];
        const otherTypes = Object.values(DocumentType).filter(
          (t) => !restrictedTypes.includes(t)
        );
        allowedTypes.push(...otherTypes);
      }

      if (allowedTypes.length === 0) {
        // User has no permissions for any document type
        return sendErrorResponse(
          res,
          "Permission denied: No document view permissions",
          StatusCodes.FORBIDDEN
        );
      }

      // Filter by allowed types at DB level
      where.type = { in: allowedTypes };
    } else {
      // No projectId, no type: need to filter by permissions globally
      const allowedTypes = [];

      if (canViewQuotes) {
        allowedTypes.push(DocumentType.QUOTE, DocumentType.QUOTE_VARIANT);
      }
      if (canViewWorkplans) {
        allowedTypes.push(DocumentType.WORKPLAN);
      }
      if (canViewOtherDocs) {
        const restrictedTypes = [
          DocumentType.QUOTE,
          DocumentType.QUOTE_VARIANT,
          DocumentType.WORKPLAN,
        ];
        const otherTypes = Object.values(DocumentType).filter(
          (t) => !restrictedTypes.includes(t)
        );
        allowedTypes.push(...otherTypes);
      }

      if (allowedTypes.length === 0) {
        return sendErrorResponse(
          res,
          "Permission denied: No document view permissions",
          StatusCodes.FORBIDDEN
        );
      }

      where.type = { in: allowedTypes };
    }

    // Now execute query with all filters applied at DB level
    const total = await prisma.document.count({ where });

    const documents = await prisma.document.findMany({
      where,
      include: {
        project: {
          include: {
            client: true,
          },
        },
        revisions: {
          orderBy: { createdAt: "desc" },
        },
        workplanSlides: {
          orderBy: { slideNumber: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limitNum,
    });

    const totalPages = divideAndRoundUp(total, limitNum);

    return sendSuccessResponse(
      res,
      {
        documents,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      },
      "Documents fetched successfully",
      StatusCodes.OK
    );
  })
);

/**
 * GET /api/v1/ui/documents/:id
 * Get document by ID with all relations
 */
router.get(
  "/:id",
  requireAuthForUI,
  requirePermission("documents", "view"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const document = await prisma.document.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        project: {
          include: {
            client: true,
          },
        },
        revisions: {
          orderBy: { createdAt: "desc" },
        },
        workplanSlides: {
          orderBy: { slideNumber: "asc" },
        },
      },
    });

    if (!document) {
      return sendErrorResponse(
        res,
        "Document not found",
        StatusCodes.NOT_FOUND
      );
    }

    return sendSuccessResponse(
      res,
      document,
      "Document fetched successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/documents/:id/send-to-client
 * Accept and send document to client (combined action)
 * This replaces the separate accept endpoint - "Accept & send to client" is one action
 * Works for BRAND_ORIGIN (must be in PM_REVIEW) and QUOTE (must be in FINANCE_MANAGER_REVIEW)
 */
router.post(
  "/:id/send-to-client",
  requireAuthForUI,
  requirePermission("documents", "acceptAndSend"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { quoteId } = req.query; // Optional: for quote variant selection
    const userId = req.user.id;
    const actingRole = req.actingRole;

    const document = await prisma.document.findUnique({
      where: { id: parseInt(id, 10) },
      include: { project: { include: { client: true } } },
    });

    if (!document) {
      return sendErrorResponse(
        res,
        "Document not found",
        StatusCodes.NOT_FOUND
      );
    }

    // Validation: Only BRAND_ORIGIN and QUOTE can be sent to client
    if (
      document.type !== DocumentType.BRAND_ORIGIN &&
      document.type !== DocumentType.QUOTE
    ) {
      return sendErrorResponse(
        res,
        "Only brand origin and quote documents can be sent to client",
        StatusCodes.BAD_REQUEST
      );
    }

    // Status validation: BRAND_ORIGIN must be in PM_REVIEW
    if (
      document.type === DocumentType.BRAND_ORIGIN &&
      document.status !== DocumentStatus.PM_REVIEW
    ) {
      return sendErrorResponse(
        res,
        `Brand origin document must be in ${DocumentStatus.PM_REVIEW} status`,
        StatusCodes.BAD_REQUEST
      );
    }

    // Status validation: QUOTE must be in FINANCE_MANAGER_REVIEW
    if (
      document.type === DocumentType.QUOTE &&
      document.status !== DocumentStatus.FINANCE_MANAGER_REVIEW
    ) {
      return sendErrorResponse(
        res,
        `Quote document must be in ${DocumentStatus.FINANCE_MANAGER_REVIEW} status`,
        StatusCodes.BAD_REQUEST
      );
    }

    // Generate correlation ID for tracking
    const correlationId = generateUuid();

    // For QUOTE documents: validate and set selectedQuoteId
    if (document.type === DocumentType.QUOTE) {
      const selectedQuoteId = quoteId || document.selectedQuoteId;
      if (!selectedQuoteId) {
        return sendErrorResponse(
          res,
          "A quote variant must be selected before sending to client",
          StatusCodes.BAD_REQUEST
        );
      }

      // If quoteId provided, validate it belongs to this document and update selectedQuoteId
      if (quoteId && quoteId !== document.selectedQuoteId) {
        // Validate quoteId is valid (check if it's in erp_quote_id or erp_variant_ids)
        const validQuoteIds = [
          document.erpQuoteId,
          ...(Array.isArray(document.erpVariantIds)
            ? document.erpVariantIds
            : []),
        ].filter(Boolean);

        if (!validQuoteIds.includes(quoteId.toString())) {
          return sendErrorResponse(
            res,
            `Invalid quote ID. Quote ID must be the main quote (${
              document.erpQuoteId
            }) or one of the variants (${
              document.erpVariantIds?.join(", ") || "none"
            }).`,
            StatusCodes.BAD_REQUEST
          );
        }

        // Update selectedQuoteId
        await prisma.document.update({
          where: { id: document.id },
          data: {
            selectedQuoteId: quoteId.toString(),
            updatedAt: new Date(),
          },
        });

        // Create audit log for quote selection
        await prisma.auditLog.create({
          data: {
            projectId: document.projectId,
            actor: userId.toString(),
            actingRole,
            action: AuditActions.QUOTE_SELECTED,
            details: {
              documentId: document.id,
              selectedQuoteId: quoteId.toString(),
              name: req.user.name,
              selectedBy: userId,
              actingRole: actingRole,
              source: "UI",
              name: req.user.name,
            },
            at: new Date(),
          },
        });
      }
    }

    // Use existing DocumentSendingService - this handles PDF conversion, email sending, and DB updates
    const result = await DocumentSendingService.sendDocumentToClient({
      documentId: parseInt(id, 10),
      projectId: document.projectId,
      userId: userId,
      correlationId: correlationId,
    });

    // Create audit log for UI action
    await prisma.auditLog.create({
      data: {
        projectId: document.projectId,
        actor: userId.toString(),
        actingRole,
        action: AuditActions.DOCUMENT_SENT_TO_CLIENT,
        details: {
          documentId: parseInt(id, 10),
          documentType: document.type,
          selectedQuoteId:
            document.type === DocumentType.QUOTE
              ? quoteId || document.selectedQuoteId
              : null,
          sentBy: userId,
          actingRole: actingRole,
          correlationId: correlationId,
          source: "UI",
          name: req.user.name,
        },
        at: new Date(),
      },
    });

    return sendSuccessResponse(
      res,
      result,
      "Document sent to client successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/documents/:id/reject
 * Reject a document
 */
router.post(
  "/:id/reject",
  requireAuthForUI,
  requirePermission("documents", "reject"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!reason || typeof reason !== "string") {
      return sendErrorResponse(
        res,
        "Reason is required",
        StatusCodes.BAD_REQUEST
      );
    }

    const document = await prisma.document.findUnique({
      where: { id: parseInt(id, 10) },
      include: { project: true },
    });

    if (!document) {
      return sendErrorResponse(
        res,
        "Document not found",
        StatusCodes.NOT_FOUND
      );
    }

    // Validate document can be rejected (not already rejected)
    if (document.status === DocumentStatus.REJECTED) {
      return sendErrorResponse(
        res,
        "Document is already rejected",
        StatusCodes.BAD_REQUEST
      );
    }

    // Update document status to REJECTED
    const updatedDocument = await prisma.document.update({
      where: { id: parseInt(id, 10) },
      data: {
        status: DocumentStatus.REJECTED,
        updatedAt: new Date(),
      },
      include: { project: true },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: document.projectId,
        actor: userId.toString(),
        actingRole,
        action: AuditActions.DOCUMENT_REJECTED,
        details: {
          documentId: parseInt(id, 10),
          documentType: document.type,
          reason: reason,
          rejectedBy: userId,
          actingRole: actingRole,
          source: "UI",
          name: req.user.name,
        },
        at: new Date(),
      },
    });

    return sendSuccessResponse(
      res,
      updatedDocument,
      "Document rejected successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/documents/:id/regenerate
 * Regenerate a document
 */
router.post(
  "/:id/regenerate",
  requireAuthForUI,
  requirePermission("documents", "regenerate"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
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
      where: { id: parseInt(id, 10) },
      include: { project: true },
    });

    if (!document) {
      return sendErrorResponse(
        res,
        "Document not found",
        StatusCodes.NOT_FOUND
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
        `Cannot regenerate document in ${document.status} status`,
        StatusCodes.BAD_REQUEST
      );
    }

    const feedbackText = feedback || reason;
    const correlationId = generateUuid();

    // Handle regeneration based on document type using QueueService
    let job;
    let regenerationResult;
    let intentJob = null;

    // For BRAND_ORIGIN, QUOTE, and WORKPLAN: queue intent detection first
    // Intent detection provides structured feedback (requestedChanges, slideReferences)
    // which enhances prompt quality and enables slide-specific targeting
    if (
      document.type === DocumentType.BRAND_ORIGIN ||
      document.type === DocumentType.QUOTE ||
      document.type === DocumentType.WORKPLAN
    ) {
      // Queue feedback intent detection job
      intentJob = await QueueService.addFeedbackIntentJob(
        {
          documentId: document.id,
          feedbackText: feedbackText,
          correlationId: correlationId,
        },
        6 // Very high priority for intent detection
      );

      logger.info(
        {
          documentId: document.id,
          documentType: document.type,
          intentJobId: intentJob.id,
          correlationId,
        },
        "Feedback intent detection job queued"
      );
    }

    if (document.type === DocumentType.BRAND_ORIGIN) {
      // For brand origin: use addBrandOriginGenerationJob with feedbackContext
      job = await QueueService.addBrandOriginGenerationJob(
        {
          projectId: document.projectId,
          feedbackContext: {
            isRegeneration: true,
            isUIRegeneration: true, // Flag to distinguish UI regeneration from email intent regeneration
            originalDocumentId: document.id,
            feedback: feedbackText,
            actorId: userId,
            actingRole: actingRole,
            source: "UI",
          },
          intentJobId: intentJob?.id || null, // Pass intent job ID to wait for result
        },
        5 // High priority for regeneration
      );

      regenerationResult = {
        documentId: document.id,
        documentType: document.type,
        jobId: job?.id || null,
        intentJobId: intentJob?.id || null,
        message: "Brand origin regeneration queued",
      };
    } else if (document.type === DocumentType.QUOTE) {
      // For quote: use addQuoteUpdateJob if document was sent, or addQuoteGenerationJob if not
      // Check if quote was sent to client (has selectedQuoteId and lastSentRevisionId)
      if (document.selectedQuoteId && document.lastSentRevisionId) {
        // Quote was sent - use update job
        job = await QueueService.addQuoteUpdateJob(
          {
            projectId: document.projectId,
            documentId: document.id,
            feedbackContext: {
              isRegeneration: true,
              isUIRegeneration: true, // Flag to distinguish UI regeneration from email intent regeneration
              feedback: feedbackText,
              actorId: userId,
              actingRole: actingRole,
              source: "UI",
            },
            intentJobId: intentJob?.id || null, // Pass intent job ID to wait for result
          },
          5 // High priority
        );
      } else {
        // Quote not sent yet - regenerate from scratch
        job = await QueueService.addQuoteGenerationJob(
          {
            projectId: document.projectId,
            dedupeKey: `project:${document.projectId}:quote:regenerate:${document.id}`,
            feedbackContext: {
              isRegeneration: true,
              isUIRegeneration: true, // Flag to distinguish UI regeneration from email intent regeneration
              originalDocumentId: document.id,
              feedback: feedbackText,
              source: "UI",
            },
            intentJobId: intentJob?.id || null, // Pass intent job ID to wait for result
          },
          5 // High priority
        );
      }

      regenerationResult = {
        documentId: document.id,
        documentType: document.type,
        jobId: job?.id || null,
        intentJobId: intentJob?.id || null,
        message: "Quote regeneration queued",
      };
    } else if (document.type === DocumentType.WORKPLAN) {
      // For workplan: use addWorkplanGenerationJob with isRegeneration flag
      // Intent detection enhances feedback with structured changes and slide-specific targeting
      const {
        WorkplanPlannerService,
      } = require("@/services/workplanPlannerService");
      const serviceType = await WorkplanPlannerService.getServiceType(
        document.projectId
      );

      job = await QueueService.addWorkplanGenerationJob(
        {
          projectId: document.projectId,
          serviceType: serviceType,
          documentId: document.id,
          isRegeneration: true,
          isUIRegeneration: true, // Flag to distinguish UI regeneration from email intent regeneration
          regenerationReason: feedbackText, // Keep raw text for backward compatibility
          intentJobId: intentJob?.id || null, // Pass intent job ID to wait for structured result
        },
        5 // High priority
      );

      regenerationResult = {
        documentId: document.id,
        documentType: document.type,
        jobId: job?.id || null,
        intentJobId: intentJob?.id || null,
        message: "Workplan regeneration queued",
      };
    } else {
      return sendErrorResponse(
        res,
        `Regeneration not supported for document type: ${document.type}`,
        StatusCodes.BAD_REQUEST
      );
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: document.projectId,
        actor: userId.toString(),
        actingRole,
        action: AuditActions.DOCUMENT_REGENERATION_TRIGGERED,
        details: {
          documentId: document.id,
          documentType: document.type,
          feedback: feedbackText,
          jobId: job?.id || null,
          regeneratedBy: userId,
          actingRole: actingRole,
          source: "UI",
          name: req.user.name,
        },
        at: new Date(),
      },
    });

    return sendSuccessResponse(
      res,
      regenerationResult,
      "Document regeneration queued successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
