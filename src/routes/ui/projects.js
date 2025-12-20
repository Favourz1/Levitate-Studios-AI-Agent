const express = require("express");
const router = express.Router();
const { asyncHandler } = require("@/middleware/errorHandler");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { StatusCodes } = require("http-status-codes");
const { getPrismaClient, withTransaction } = require("@/database");
const { requireAuthForUI } = require("@/middleware/auth");
const { requirePermission } = require("@/utils/permissions");
const { divideAndRoundUp } = require("@/utils/pagination");
const {
  ProjectPhase,
  DocumentType,
  DocumentStatus,
  AuditActions,
  ProjectPhaseOrder,
  SystemActors,
} = require("@/constants");
const { appConfig } = require("@/config");
const {
  isValidProjectPhaseTransition,
} = require("@/utils/validation/commonValidation");
const { createLogger } = require("@/utils/logger");
const { erpIntegration } = require("@/integrations/levitateStudiosErp");
// Import reusable phase transition functions from workers
const {
  handleBrandOriginAcceptance,
  handleQuoteAcceptance,
} = require("@/workers/emailIntent");
const { triggerWorkplanGeneration } = require("@/workers/asanaProjectInit");
const { FormSubmissionService } = require("@/services/formSubmissionService");

const logger = createLogger("routes:ui:projects");
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
        asanaLinks: {
          include: {
            tasks: true,
          },
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
 *
 * PURPOSE:
 * This API allows team members to manually advance a project to the next phase
 * without waiting for the AI agent to automatically detect email intent.
 * It ensures the SAME background jobs are triggered as the automatic system.
 *
 * USE CASES:
 * 1. Client confirms document approval via phone call, Slack, WhatsApp, or in-person
 * 2. Client sends feedback via channels not monitored by the email listener
 * 3. Team wants to skip waiting for client response and proceed with next phase
 * 4. Document is in PM_REVIEW or FINANCE_MANAGER_REVIEW and needs to proceed
 * 5. Recovery from FAILED document status after manual fixes
 *
 * CRITICAL:
 * The main purpose is to trigger background jobs (quote generation, Asana init, etc.).
 * If jobs cannot be triggered, the API MUST FAIL to prevent broken workflows.
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
    const correlationId = `manual-advance-${id}-${Date.now()}`;

    // Validate reason is provided
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return sendErrorResponse(
        res,
        "Reason is required for manual phase advancement",
        StatusCodes.BAD_REQUEST
      );
    }

    try {
      // Step 1: Load project and validate within transaction
      const validationResult = await withTransaction(async (tx) => {
        const project = await tx.project.findUnique({
          where: { id: parseInt(id, 10) },
          include: {
            documents: true,
            asanaLinks: true,
            client: true, // Include client for handleQuoteAcceptance
          },
        });

        if (!project) {
          return {
            error: "Project not found",
            statusCode: StatusCodes.NOT_FOUND,
          };
        }

        // Validation: Cannot advance if FINALIZED or REJECTED
        if (
          project.phase === ProjectPhase.FINALIZED ||
          project.phase === ProjectPhase.REJECTED
        ) {
          return {
            error:
              "Cannot advance project in FINALIZED or REJECTED phase. Use restart endpoint to restart rejected projects.",
            statusCode: StatusCodes.BAD_REQUEST,
          };
        }

        // Determine next phase
        const currentIndex = ProjectPhaseOrder.indexOf(project.phase);
        const nextPhase = ProjectPhaseOrder[currentIndex + 1];

        if (!nextPhase) {
          return {
            error: `Project is already in the final phase: ${project.phase}`,
            statusCode: StatusCodes.BAD_REQUEST,
          };
        }

        // Validate phase transition
        if (!isValidProjectPhaseTransition(project.phase, nextPhase)) {
          return {
            error: `Invalid phase transition from ${project.phase} to ${nextPhase}`,
            statusCode: StatusCodes.BAD_REQUEST,
          };
        }

        // Check for concurrent advancement (optimistic locking)
        const currentProject = await tx.project.findUnique({
          where: { id: project.id },
          select: { phase: true },
        });

        if (currentProject.phase !== project.phase) {
          return {
            error:
              "Project phase was changed by another user. Please refresh and try again.",
            statusCode: StatusCodes.CONFLICT,
          };
        }

        // Validation based on current phase
        if (project.phase === ProjectPhase.BRAND_ORIGIN) {
          const brandOrigin = project.documents.find(
            (d) => d.type === DocumentType.BRAND_ORIGIN
          );
          if (!brandOrigin) {
            return {
              error:
                "Brand origin document not found. Cannot advance to next phase.",
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }

          // Check for FAILED status - require regeneration
          if (brandOrigin.status === DocumentStatus.FAILED) {
            return {
              error:
                "Brand origin document is in FAILED status. Please regenerate the document before advancing.",
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }

          // Validate document is in appropriate status
          if (
            ![
              DocumentStatus.PM_REVIEW,
              DocumentStatus.SENT_TO_CLIENT,
              DocumentStatus.CLIENT_FEEDBACK,
              DocumentStatus.ACCEPTED,
              DocumentStatus.REJECTED,
            ].includes(brandOrigin.status)
          ) {
            return {
              error: `Brand origin document must be in PM_REVIEW, SENT_TO_CLIENT, CLIENT_FEEDBACK, ACCEPTED, or REJECTED status to advance`,
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }

          // Auto-accept document if not already accepted
          if (brandOrigin.status !== DocumentStatus.ACCEPTED) {
            await tx.document.update({
              where: { id: brandOrigin.id },
              data: { status: DocumentStatus.ACCEPTED },
            });
            logger.info(
              {
                projectId: project.id,
                documentId: brandOrigin.id,
                correlationId,
              },
              "Auto-accepted brand origin document during manual phase advancement"
            );
            // Audit log
            await tx.auditLog.create({
              data: {
                projectId: project.id,
                actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
                action: AuditActions.BRAND_ORIGIN_AUTO_ACCEPTED,
                details: {
                  documentId: brandOrigin.id,
                  documentType: DocumentType.BRAND_ORIGIN,
                  phase: project.phase,
                  reason:
                    "Auto-accepted by Levitate AI agent system during phase advancement",
                  source: "UI",
                  correlationId,
                },
                at: new Date(),
              },
            });
          }
        }

        if (project.phase === ProjectPhase.QUOTE_DOCUMENT) {
          const quote = project.documents.find(
            (d) => d.type === DocumentType.QUOTE
          );
          if (!quote) {
            return {
              error: "Quote document not found. Cannot advance to next phase.",
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }

          // Check for FAILED status - require regeneration
          if (quote.status === DocumentStatus.FAILED) {
            return {
              error:
                "Quote document is in FAILED status. Please regenerate the document before advancing.",
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }

          // Validate document is in appropriate status
          if (
            ![
              DocumentStatus.FINANCE_MANAGER_REVIEW,
              DocumentStatus.SENT_TO_CLIENT,
              DocumentStatus.CLIENT_FEEDBACK,
              DocumentStatus.ACCEPTED,
              DocumentStatus.REJECTED,
            ].includes(quote.status)
          ) {
            return {
              error: `Quote document must be in FINANCE_MANAGER_REVIEW, SENT_TO_CLIENT, CLIENT_FEEDBACK, ACCEPTED, or REJECTED status to advance`,
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }

          // If no selected quote, set main quote as selected
          if (!quote.selectedQuoteId && quote.erpQuoteId) {
            await tx.document.update({
              where: { id: quote.id },
              data: { selectedQuoteId: quote.erpQuoteId },
            });
            logger.info(
              {
                projectId: project.id,
                quoteId: quote.erpQuoteId,
                correlationId,
              },
              "Auto-selected main quote during manual phase advancement"
            );
          }

          // Verify selected quote exists and is not cancelled
          if (quote.selectedQuoteId) {
            try {
              const quoteDetails = await erpIntegration.getQuotation(
                quote.selectedQuoteId
              );
              if (quoteDetails.quotation_canceled) {
                return {
                  error: `Selected quote ${quote.selectedQuoteId} is cancelled. Please select a different quote or create a new one.`,
                  statusCode: StatusCodes.BAD_REQUEST,
                };
              }
            } catch (error) {
              logger.error(
                {
                  projectId: project.id,
                  selectedQuoteId: quote.selectedQuoteId,
                  error: error.message,
                  correlationId,
                },
                "Failed to verify quote status"
              );
              return {
                error: `Failed to verify quote status: ${error.message}`,
                statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
              };
            }
          }

          // Auto-accept document if not already accepted
          if (quote.status !== DocumentStatus.ACCEPTED) {
            await tx.document.update({
              where: { id: quote.id },
              data: { status: DocumentStatus.ACCEPTED },
            });
            logger.info(
              { projectId: project.id, documentId: quote.id, correlationId },
              "Auto-accepted quote document during manual phase advancement"
            );
          }
        }

        if (project.phase === ProjectPhase.ASANA_INIT) {
          const asanaLink = project.asanaLinks?.[0];
          if (!asanaLink || !asanaLink.finalizedBoardGid) {
            return {
              error:
                "Asana project must be initialized before advancing. Please wait for Asana project initialization to complete.",
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }
          if (!project.asanaProjectGid) {
            return {
              error:
                "Asana project GID not found. Please wait for Asana project initialization to complete.",
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }
        }

        if (project.phase === ProjectPhase.WORKPLAN_GENERATION) {
          const workplan = project.documents.find(
            (d) => d.type === DocumentType.WORKPLAN
          );
          if (!workplan) {
            return {
              error:
                "Workplan document not found. Cannot advance to next phase.",
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }

          // Check for FAILED status - require regeneration
          if (workplan.status === DocumentStatus.FAILED) {
            return {
              error:
                "Workplan document is in FAILED status. Please regenerate the document before advancing.",
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }

          // Validate document is in appropriate status
          if (
            ![
              DocumentStatus.COMPLETED,
              DocumentStatus.ACCEPTED,
              DocumentStatus.REJECTED,
            ].includes(workplan.status)
          ) {
            return {
              error: `Workplan must be in COMPLETED, ACCEPTED, or REJECTED status to advance`,
              statusCode: StatusCodes.BAD_REQUEST,
            };
          }
        }

        return { success: true, project, nextPhase };
      });

      // Handle validation errors
      if (validationResult.error) {
        return sendErrorResponse(
          res,
          validationResult.error,
          validationResult.statusCode
        );
      }

      const { project, nextPhase } = validationResult;
      const fromPhase = project.phase;

      // Step 2: CRITICAL - Trigger background jobs FIRST (main purpose of this API)
      // If this fails, we must not advance the phase
      let phaseUpdatedByWorker = false; // Track if worker handled phase transition
      try {
        phaseUpdatedByWorker = await triggerPhaseTransitionJobs(
          project,
          fromPhase,
          nextPhase,
          correlationId
        );
      } catch (jobError) {
        logger.error(
          {
            projectId: project.id,
            fromPhase,
            toPhase: nextPhase,
            error: jobError.message,
            stack: jobError.stack,
            correlationId,
          },
          "CRITICAL: Failed to trigger background jobs - aborting phase advancement"
        );

        // Create audit log for failed attempt
        await prisma.auditLog.create({
          data: {
            projectId: project.id,
            actor: userId.toString(),
            actingRole,
            action: "PROJECT_PHASE_ADVANCEMENT_FAILED",
            details: {
              fromPhase,
              toPhase: nextPhase,
              reason: reason,
              error: jobError.message,
              advancedBy: userId,
              source: "UI",
              name: req.user.name,
              correlationId,
            },
            at: new Date(),
          },
        });

        return sendErrorResponse(
          res,
          `Failed to trigger background jobs: ${jobError.message}. Phase was not changed to prevent broken workflows.`,
          StatusCodes.INTERNAL_SERVER_ERROR
        );
      }

      // Step 3: Update project phase in database ONLY if worker didn't handle it
      let updatedProject;
      if (phaseUpdatedByWorker) {
        // Worker already updated phase, just fetch the updated project
        updatedProject = await prisma.project.findUnique({
          where: { id: project.id },
        });

        logger.info(
          {
            projectId: project.id,
            fromPhase,
            toPhase: nextPhase,
            correlationId,
          },
          "Phase was updated by worker function, skipping API-level phase update"
        );
      } else {
        // API needs to update phase
        updatedProject = await withTransaction(async (tx) => {
          const updated = await tx.project.update({
            where: { id: project.id },
            data: { phase: nextPhase, updatedAt: new Date() },
          });

          // Log phase change
          await tx.projectPhaseLog.create({
            data: {
              projectId: project.id,
              fromPhase: fromPhase,
              toPhase: nextPhase,
              reason: reason,
              actor: `USER (${req.user.name})`,
              at: new Date(),
            },
          });

          // Create audit log
          await tx.auditLog.create({
            data: {
              projectId: project.id,
              actor: userId.toString(),
              actingRole,
              action: AuditActions.PROJECT_PHASE_ADVANCED,
              details: {
                fromPhase: fromPhase,
                toPhase: nextPhase,
                reason: reason,
                advancedBy: userId,
                actingRole: actingRole,
                source: "UI",
                name: req.user.name,
                correlationId,
              },
              at: new Date(),
            },
          });

          return updated;
        });
      }

      logger.info(
        {
          projectId: updatedProject.id,
          fromPhase,
          toPhase: nextPhase,
          correlationId,
        },
        "Project phase advanced successfully with background jobs triggered"
      );

      return sendSuccessResponse(
        res,
        updatedProject,
        "Project phase advanced successfully",
        StatusCodes.OK
      );
    } catch (error) {
      logger.error(
        {
          projectId: id,
          error: error.message,
          stack: error.stack,
          correlationId,
        },
        "Error in advance-phase API"
      );

      // Return appropriate error response
      return sendErrorResponse(
        res,
        error.message || "Failed to advance project phase",
        error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR
      );
    }
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

/**
 * POST /api/v1/ui/projects/:id/restart
 * Restart a rejected or failed project from BRAND_ORIGIN phase
 *
 * PURPOSE:
 * This API allows team members to restart a project that was previously rejected
 * or has failed documents. It ALWAYS restarts from BRAND_ORIGIN phase to ensure
 * a clean, fresh start, similar to how new projects begin from form submission.
 *
 * USE CASES:
 * 1. Client rejected project but now wants to proceed with modifications
 * 2. Document generation failed and needs to be restarted from scratch
 * 3. Project was rejected due to miscommunication and needs to restart
 * 4. Team wants to regenerate all documents fresh from the beginning
 *
 * CRITICAL:
 * - ALWAYS restarts from BRAND_ORIGIN (no other phase allowed)
 * - Archives ALL existing documents (regardless of status) for audit trail
 * - Triggers brand origin generation job (same as form submission)
 * - If job triggering fails, API MUST FAIL and rollback phase change
 */
router.post(
  "/:id/restart",
  requireAuthForUI,
  requirePermission("projects", "advance"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;
    const correlationId = `restart-${id}-${Date.now()}`;

    // Validate reason is provided
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return sendErrorResponse(
        res,
        "Reason is required for project restart",
        StatusCodes.BAD_REQUEST
      );
    }

    try {
      // Step 1: Validate project can be restarted
      const validationResult = await withTransaction(async (tx) => {
        const project = await tx.project.findUnique({
          where: { id: parseInt(id, 10) },
          include: {
            documents: true,
            client: true,
          },
        });

        if (!project) {
          return {
            error: "Project not found",
            statusCode: StatusCodes.NOT_FOUND,
          };
        }

        // Validation: Can only restart REJECTED projects or projects with FAILED documents
        const hasFailedDocuments = project.documents.some(
          (d) => d.status === DocumentStatus.FAILED
        );

        if (project.phase !== ProjectPhase.REJECTED && !hasFailedDocuments) {
          return {
            error:
              "Can only restart REJECTED projects or projects with FAILED documents",
            statusCode: StatusCodes.BAD_REQUEST,
          };
        }

        return { success: true, project };
      });

      // Handle validation errors
      if (validationResult.error) {
        return sendErrorResponse(
          res,
          validationResult.error,
          validationResult.statusCode
        );
      }

      const { project } = validationResult;
      const fromPhase = project.phase;

      // Step 2: CRITICAL - Trigger brand origin generation job FIRST
      // If this fails, we must not restart the project
      try {
        await FormSubmissionService.enqueueBrandOriginGeneration(
          project.id,
          correlationId
        );

        logger.info(
          {
            projectId: project.id,
            correlationId,
          },
          "Brand origin generation job enqueued for restart"
        );
      } catch (jobError) {
        logger.error(
          {
            projectId: project.id,
            error: jobError.message,
            stack: jobError.stack,
            correlationId,
          },
          "CRITICAL: Failed to trigger brand origin generation - aborting restart"
        );

        // Create audit log for failed attempt
        await prisma.auditLog.create({
          data: {
            projectId: project.id,
            actor: userId.toString(),
            actingRole,
            action: "PROJECT_RESTART_FAILED",
            details: {
              fromPhase,
              toPhase: ProjectPhase.BRAND_ORIGIN,
              reason: reason,
              error: jobError.message,
              restartedBy: userId,
              actingRole: actingRole,
              source: "UI",
              name: req.user.name,
              correlationId,
            },
            at: new Date(),
          },
        });

        return sendErrorResponse(
          res,
          `Failed to trigger brand origin generation: ${jobError.message}. Project was not restarted to prevent broken workflows.`,
          StatusCodes.INTERNAL_SERVER_ERROR
        );
      }

      // Step 3: Update project phase and archive documents (job triggered successfully)
      const updatedProject = await withTransaction(async (tx) => {
        // Archive ALL existing documents (regardless of status)
        if (project.documents.length > 0) {
          for (const doc of project.documents) {
            await tx.document.update({
              where: { id: doc.id },
              data: {
                status: DocumentStatus.REJECTED,
                metadataInfo: {
                  ...(doc.metadataInfo || {}),
                  archivedAt: new Date().toISOString(),
                  archivedReason:
                    "Project restart - fresh start from BRAND_ORIGIN",
                  archivedBy: userId,
                  previousStatus: doc.status,
                },
              },
            });
          }

          logger.info(
            {
              projectId: project.id,
              archivedCount: project.documents.length,
              correlationId,
            },
            "Archived all documents during project restart"
          );
        }

        // Update project phase to BRAND_ORIGIN
        const updated = await tx.project.update({
          where: { id: project.id },
          data: { phase: ProjectPhase.BRAND_ORIGIN, updatedAt: new Date() },
        });

        // Log phase change
        await tx.projectPhaseLog.create({
          data: {
            projectId: project.id,
            fromPhase: fromPhase,
            toPhase: ProjectPhase.BRAND_ORIGIN,
            reason: `Project restart: ${reason}`,
            actor: `USER (${req.user.name})`,
            at: new Date(),
          },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            projectId: project.id,
            actor: userId.toString(),
            actingRole,
            action: AuditActions.PROJECT_RESTARTED,
            details: {
              fromPhase: fromPhase,
              toPhase: ProjectPhase.BRAND_ORIGIN,
              reason: reason,
              restartedBy: userId,
              actingRole: actingRole,
              source: "UI",
              name: req.user.name,
              archivedDocuments: project.documents.length,
              correlationId,
            },
            at: new Date(),
          },
        });

        return updated;
      });

      logger.info(
        {
          projectId: updatedProject.id,
          fromPhase,
          toPhase: ProjectPhase.BRAND_ORIGIN,
          correlationId,
        },
        "Project restarted successfully from BRAND_ORIGIN with brand origin generation job triggered"
      );

      return sendSuccessResponse(
        res,
        updatedProject,
        "Project restarted successfully from BRAND_ORIGIN phase",
        StatusCodes.OK
      );
    } catch (error) {
      logger.error(
        {
          projectId: id,
          error: error.message,
          stack: error.stack,
          correlationId,
        },
        "Error in restart API"
      );

      // Return appropriate error response
      return sendErrorResponse(
        res,
        error.message || "Failed to restart project",
        error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR
      );
    }
  })
);

/**
 * Helper function to trigger background jobs based on phase transition
 * Uses existing reusable functions from workers to ensure business logic consistency
 * @param {Object} project - Updated project object
 * @param {string} fromPhase - Previous phase
 * @param {string} toPhase - New phase
 * @param {string} correlationId - Correlation ID for tracking
 * @returns {Promise<boolean>} True if worker updated phase, false if API should update
 */
async function triggerPhaseTransitionJobs(
  project,
  fromPhase,
  toPhase,
  correlationId
) {
  logger.info(
    {
      projectId: project.id,
      fromPhase,
      toPhase,
      correlationId,
    },
    "Triggering background jobs for phase transition using existing worker functions"
  );

  try {
    // BRAND_ORIGIN → QUOTE_DOCUMENT: Use handleBrandOriginAcceptance from emailIntent.js
    // Worker triggers job, API handles phase transition
    if (
      fromPhase === ProjectPhase.BRAND_ORIGIN &&
      toPhase === ProjectPhase.QUOTE_DOCUMENT
    ) {
      await handleBrandOriginAcceptance(
        project,
        correlationId,
        { skipPhaseTransition: true } // We handle phase transition at API level
      );

      logger.info(
        { projectId: project.id, correlationId },
        "Brand origin acceptance workflow triggered"
      );

      return false; // API should update phase
    }

    // QUOTE_DOCUMENT → ASANA_INIT: Use handleQuoteAcceptance from emailIntent.js
    // Worker handles EVERYTHING including phase transition via finalizeProject
    else if (
      fromPhase === ProjectPhase.QUOTE_DOCUMENT &&
      toPhase === ProjectPhase.ASANA_INIT
    ) {
      // Get quote document for handleQuoteAcceptance
      const quote = await prisma.document.findFirst({
        where: {
          projectId: project.id,
          type: DocumentType.QUOTE,
        },
        orderBy: { updatedAt: "desc" },
      });

      if (!quote) {
        throw new Error("Quote document not found for phase transition");
      }

      // Call handleQuoteAcceptance (it internally calls finalizeProject which updates phase)
      // Pass null for email and intentResult since this is manual
      await handleQuoteAcceptance(
        project,
        quote,
        null, // email - null for manual advancement
        { summary: "Manual advancement from UI" }, // intentResult
        correlationId
      );

      logger.info(
        { projectId: project.id, correlationId },
        "Quote acceptance workflow triggered (phase updated by worker)"
      );

      return true; // Worker updated phase, API should NOT update
    }

    // ASANA_INIT → WORKPLAN_GENERATION: Use triggerWorkplanGeneration from asanaProjectInit.js
    // Worker only triggers job, API handles phase transition
    else if (
      fromPhase === ProjectPhase.ASANA_INIT &&
      toPhase === ProjectPhase.WORKPLAN_GENERATION
    ) {
      await triggerWorkplanGeneration(project.id, correlationId);

      logger.info(
        { projectId: project.id, correlationId },
        "Workplan generation job enqueued"
      );

      return false; // API should update phase
    }

    // WORKPLAN_GENERATION → FINALIZED: No jobs to trigger
    else if (
      fromPhase === ProjectPhase.WORKPLAN_GENERATION &&
      toPhase === ProjectPhase.FINALIZED
    ) {
      logger.info(
        { projectId: project.id, correlationId },
        "No background jobs needed for transition to FINALIZED"
      );

      return false; // API should update phase
    }

    logger.info(
      {
        projectId: project.id,
        fromPhase,
        toPhase,
        correlationId,
      },
      "Background jobs triggered successfully"
    );

    return false; // Default: API should update phase
  } catch (error) {
    logger.error(
      {
        projectId: project.id,
        fromPhase,
        toPhase,
        error: error.message,
        stack: error.stack,
        correlationId,
      },
      "Failed to trigger background jobs"
    );
    throw error; // Re-throw to fail the API
  }
}

module.exports = router;
