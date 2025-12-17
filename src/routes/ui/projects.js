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
const { divideAndRoundUp } = require("@/utils/pagination");
const {
  ProjectPhase,
  DocumentType,
  DocumentStatus,
  AuditActions,
} = require("@/constants");
const { appConfig } = require("@/config");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/projects
 * List projects with filters, search, and pagination
 */
router.get(
  "/",
  requireAuthForUI,
  requirePermission("projects", "viewAll"),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, phase, search, clientId } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE clause
    const where = {
      ...(phase && { phase }),
      ...(clientId && { clientId: parseInt(clientId, 10) }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { client: { name: { contains: search, mode: "insensitive" } } },
        ],
      }),
    };

    // Get total count
    const total = await prisma.project.count({ where });

    // Get projects with minimal relations (only what's needed for ProjectsTable)
    const projects = await prisma.project.findMany({
      where,
      select: {
        id: true,
        clientId: true,
        name: true,
        phase: true,
        asanaProjectGid: true,
        updatedAt: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            name: true,
            primaryEmail: true,
            status: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limitNum,
    });

    // Add asanaProjectUrl to each project if asanaProjectGid exists
    const projectsWithAsanaUrl = projects.map((project) => ({
      ...project,
      asanaProjectUrl: project.asanaProjectGid
        ? `https://app.asana.com/1/${appConfig.asana.workspaceGid}/project/${project.asanaProjectGid}/`
        : null,
    }));

    const totalPages = divideAndRoundUp(total, limitNum);

    return sendSuccessResponse(
      res,
      {
        projects: projectsWithAsanaUrl,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      },
      "Projects fetched successfully",
      StatusCodes.OK
    );
  })
);

/**
 * GET /api/v1/ui/projects/:id
 * Get project by ID with all relations
 */
router.get(
  "/:id",
  requireAuthForUI,
  requirePermission("projects", "view"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        client: true,
        documents: {
          include: {
            revisions: {
              orderBy: { createdAt: "desc" },
            },
            workplanSlides: {
              orderBy: { slideNumber: "asc" },
            },
          },
        },
        emailThreads: {
          include: {
            emails: {
              orderBy: { receivedAt: "desc" },
            },
          },
        },
        asanaLinks: {
          include: {
            tasks: true,
          },
        },
        auditLogs: {
          orderBy: { at: "desc" },
          take: 50,
        },
      },
    });

    if (!project) {
      return sendErrorResponse(res, "Project not found", StatusCodes.NOT_FOUND);
    }

    // Add asanaProjectUrl if asanaProjectGid exists
    const projectWithAsanaUrl = {
      ...project,
      asanaProjectUrl: project.asanaProjectGid
        ? `https://app.asana.com/1/${appConfig.asana.workspaceGid}/project/${project.asanaProjectGid}/`
        : null,
    };

    return sendSuccessResponse(
      res,
      projectWithAsanaUrl,
      "Project fetched successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/projects/:id/advance-phase
 * Manually advance project phase
 */
router.post(
  "/:id/advance-phase",
  requireAuthForUI,
  requirePermission("projects", "advance"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    const project = await prisma.project.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        documents: true,
        asanaLinks: true,
      },
    });

    if (!project) {
      return sendErrorResponse(res, "Project not found", StatusCodes.NOT_FOUND);
    }

    // Validation: Cannot advance if FINALIZED or REJECTED
    if (
      project.phase === ProjectPhase.FINALIZED ||
      project.phase === ProjectPhase.REJECTED
    ) {
      return sendErrorResponse(
        res,
        "Cannot advance project in FINALIZED or REJECTED phase",
        StatusCodes.BAD_REQUEST
      );
    }

    // Validation based on current phase
    if (project.phase === ProjectPhase.BRAND_ORIGIN) {
      const brandOrigin = project.documents.find(
        (d) => d.type === DocumentType.BRAND_ORIGIN
      );
      if (
        !brandOrigin ||
        ![
          DocumentStatus.PM_REVIEW,
          DocumentStatus.SENT_TO_CLIENT,
          DocumentStatus.CLIENT_FEEDBACK,
          DocumentStatus.ACCEPTED,
          DocumentStatus.FAILED,
          DocumentStatus.REJECTED,
        ].includes(brandOrigin.status)
      ) {
        return sendErrorResponse(
          res,
          `Brand origin document must be in ${DocumentStatus.PM_REVIEW}, ${DocumentStatus.SENT_TO_CLIENT}, ${DocumentStatus.CLIENT_FEEDBACK}, ${DocumentStatus.ACCEPTED}, ${DocumentStatus.FAILED}, or ${DocumentStatus.REJECTED} status`,
          StatusCodes.BAD_REQUEST
        );
      }
    }

    if (project.phase === ProjectPhase.QUOTE_DOCUMENT) {
      const quote = project.documents.find(
        (d) => d.type === DocumentType.QUOTE
      );
      if (
        !quote ||
        ![
          DocumentStatus.FINANCE_MANAGER_REVIEW,
          DocumentStatus.SENT_TO_CLIENT,
          DocumentStatus.CLIENT_FEEDBACK,
          DocumentStatus.ACCEPTED,
          DocumentStatus.FAILED,
          DocumentStatus.REJECTED,
        ].includes(quote.status)
      ) {
        return sendErrorResponse(
          res,
          `Quote document must be in ${DocumentStatus.FINANCE_MANAGER_REVIEW}, ${DocumentStatus.SENT_TO_CLIENT}, ${DocumentStatus.CLIENT_FEEDBACK}, ${DocumentStatus.ACCEPTED}, ${DocumentStatus.FAILED}, or ${DocumentStatus.REJECTED} status`,
          StatusCodes.BAD_REQUEST
        );
      }

      // If in FINANCE_MANAGER_REVIEW and no selected quote, set main quote as selected (use erpQuoteId)
      if (
        quote.status === DocumentStatus.FINANCE_MANAGER_REVIEW &&
        !quote.selectedQuoteId &&
        quote.erpQuoteId
      ) {
        await prisma.document.update({
          where: { id: quote.id },
          data: { selectedQuoteId: quote.erpQuoteId },
        });
      }
    }

    if (project.phase === ProjectPhase.ASANA_INIT) {
      const asanaLink = project.asanaLinks?.[0];
      if (!asanaLink || !asanaLink.finalizedBoardGid) {
        return sendErrorResponse(
          res,
          "Asana project must be initialized before advancing",
          StatusCodes.BAD_REQUEST
        );
      }
      // Also check if project has asanaProjectGid
      if (!project.asanaProjectGid) {
        return sendErrorResponse(
          res,
          "Asana project must be initialized before advancing",
          StatusCodes.BAD_REQUEST
        );
      }
    }

    if (project.phase === ProjectPhase.WORKPLAN_GENERATION) {
      const workplan = project.documents.find(
        (d) => d.type === DocumentType.WORKPLAN
      );
      if (
        !workplan ||
        ![
          DocumentStatus.COMPLETED,
          DocumentStatus.FAILED,
          DocumentStatus.ACCEPTED,
          DocumentStatus.REJECTED,
        ].includes(workplan.status)
      ) {
        return sendErrorResponse(
          res,
          `Workplan must be in ${DocumentStatus.COMPLETED}, ${DocumentStatus.FAILED}, ${DocumentStatus.ACCEPTED}, or ${DocumentStatus.REJECTED} status`,
          StatusCodes.BAD_REQUEST
        );
      }
    }

    // Determine next phase using phase order
    const phaseOrder = [
      ProjectPhase.QUESTIONNAIRE,
      ProjectPhase.BRAND_ORIGIN,
      ProjectPhase.QUOTE_DOCUMENT,
      ProjectPhase.ASANA_INIT,
      ProjectPhase.WORKPLAN_GENERATION,
      ProjectPhase.FINALIZED,
    ];
    const currentIndex = phaseOrder.indexOf(project.phase);
    const nextPhase = phaseOrder[currentIndex + 1] || project.phase;

    // Update project phase
    const updatedProject = await prisma.project.update({
      where: { id: project.id },
      data: { phase: nextPhase },
    });

    // Log phase change manually
    await prisma.projectPhaseLog.create({
      data: {
        projectId: project.id,
        fromPhase: project.phase,
        toPhase: nextPhase,
        reason: reason || "Manual phase advancement via UI",
        actor: `USER (${userId})`,
        at: new Date(),
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: userId.toString(),
        actingRole,
        action: AuditActions.PROJECT_PHASE_ADVANCED,
        details: {
          fromPhase: project.phase,
          toPhase: nextPhase,
          reason: reason || "Manual phase advancement via UI",
          advancedBy: userId,
          actingRole: actingRole,
          source: "UI",
          name: req.user.name,
        },
        at: new Date(),
      },
    });

    return sendSuccessResponse(
      res,
      updatedProject,
      "Project phase advanced successfully",
      StatusCodes.OK
    );
  })
);

/**
 * PATCH /api/v1/ui/projects/:id/context
 * Update project context
 */
router.patch(
  "/:id/context",
  requireAuthForUI,
  requirePermission("projects", "editContext"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { context } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!context || typeof context !== "string") {
      return sendErrorResponse(
        res,
        "Context is required",
        StatusCodes.BAD_REQUEST
      );
    }

    const project = await prisma.project.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!project) {
      return sendErrorResponse(res, "Project not found", StatusCodes.NOT_FOUND);
    }

    const updatedProject = await prisma.project.update({
      where: { id: project.id },
      data: { context },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: userId.toString(),
        actingRole,
        action: AuditActions.UPDATE_PROJECT_CONTEXT,
        details: {
          contextLength: context.length,
          source: "UI",
          name: req.user.name,
        },
        at: new Date(),
      },
    });

    return sendSuccessResponse(
      res,
      updatedProject,
      "Project context updated successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/projects/:id/reject
 * Reject a project
 */
router.post(
  "/:id/reject",
  requireAuthForUI,
  requirePermission("projects", "advance"),
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

    const project = await prisma.project.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!project) {
      return sendErrorResponse(res, "Project not found", StatusCodes.NOT_FOUND);
    }

    // Validation: Cannot reject if already FINALIZED or REJECTED
    if (
      project.phase === ProjectPhase.FINALIZED ||
      project.phase === ProjectPhase.REJECTED
    ) {
      return sendErrorResponse(
        res,
        "Cannot reject project in FINALIZED or REJECTED phase",
        StatusCodes.BAD_REQUEST
      );
    }

    const updatedProject = await prisma.project.update({
      where: { id: project.id },
      data: { phase: ProjectPhase.REJECTED },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: userId.toString(),
        actingRole,
        action: AuditActions.PROJECT_REJECTED,
        details: {
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
      updatedProject,
      "Project rejected successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
