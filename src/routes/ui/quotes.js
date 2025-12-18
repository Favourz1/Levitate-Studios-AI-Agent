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
const { DocumentType, AuditActions } = require("@/constants");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/quotes/:projectId
 * Get quotes for a project
 */
router.get(
  "/:projectId",
  requireAuthForUI,
  requirePermission("quotes", "view"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;

    const quotes = await prisma.document.findMany({
      where: {
        projectId: parseInt(projectId, 10),
        type: { in: [DocumentType.QUOTE, DocumentType.QUOTE_VARIANT] },
      },
      include: {
        revisions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const mainQuote = quotes.find((q) => q.type === DocumentType.QUOTE);
    const variants = quotes.filter(
      (q) => q.type === DocumentType.QUOTE_VARIANT
    );

    return sendSuccessResponse(
      res,
      {
        mainQuote,
        variants,
        selectedQuoteId: mainQuote?.selectedQuoteId || null,
      },
      "Quotes fetched successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/quotes/:documentId/select
 * Select a quote variant (ERP quote ID) as the selected quote for sending
 * Note: quoteId parameter is the ERP quote ID (erpQuoteId or one of erpVariantIds), not document ID
 */
router.post(
  "/:documentId/select",
  requireAuthForUI,
  requirePermission("quotes", "view"),
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const { quoteId } = req.body; // ERP quote ID to select
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!quoteId) {
      return sendErrorResponse(
        res,
        "quoteId (ERP quote ID) is required in request body",
        StatusCodes.BAD_REQUEST
      );
    }

    // Find main quote document
    const mainQuote = await prisma.document.findUnique({
      where: { id: parseInt(documentId, 10) },
      include: { project: true },
    });

    if (!mainQuote) {
      return sendErrorResponse(
        res,
        "Quote document not found",
        StatusCodes.NOT_FOUND
      );
    }

    if (mainQuote.type !== DocumentType.QUOTE) {
      return sendErrorResponse(
        res,
        "Document is not a quote",
        StatusCodes.BAD_REQUEST
      );
    }

    // Validate quoteId belongs to this document (must be erpQuoteId or one of erpVariantIds)
    const validQuoteIds = [
      mainQuote.erpQuoteId,
      ...(Array.isArray(mainQuote.erpVariantIds)
        ? mainQuote.erpVariantIds
        : []),
    ].filter(Boolean);

    if (!validQuoteIds.includes(quoteId.toString())) {
      return sendErrorResponse(
        res,
        `Quote ID ${quoteId} does not belong to this document. Valid quote IDs: ${validQuoteIds.join(
          ", "
        )}`,
        StatusCodes.BAD_REQUEST
      );
    }

    // Update selectedQuoteId with ERP quote ID
    await prisma.document.update({
      where: { id: parseInt(documentId, 10) },
      data: {
        selectedQuoteId: quoteId.toString(),
        updatedAt: new Date(),
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: mainQuote.projectId,
        actor: userId.toString(),
        actingRole,
        action: AuditActions.QUOTE_SELECTED,
        details: {
          documentId: parseInt(documentId, 10),
          selectedQuoteId: quoteId.toString(),
          selectedBy: userId,
          actingRole: actingRole,
          source: "UI",
          name: req.user.name,
        },
        at: new Date(),
      },
    });

    return sendSuccessResponse(
      res,
      {
        documentId: parseInt(documentId, 10),
        selectedQuoteId: quoteId.toString(),
      },
      "Quote variant selected successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
