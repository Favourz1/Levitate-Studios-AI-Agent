const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { QueueService } = require("@/queues");
const {
  DocumentType,
  DocumentStatus,
  SystemActors,
  AuditActions,
} = require("@/constants");

// TODO: Import workplan service classes (to be created in Phase 3)
// const { WorkplanService } = require("@/services/workplanService");
// const { WorkplanPlannerService } = require("@/services/workplanPlannerService");
// const { WorkplanResearcherService } = require("@/services/workplanResearcherService");
// const { WorkplanStrategistService } = require("@/services/workplanStrategistService");
// const { WorkplanArtDirectorService } = require("@/services/workplanArtDirectorService");
// const { WorkplanDocumentBuilderService } = require("@/services/workplanDocumentBuilderService");

const logger = createLogger("worker:workplanGeneration");
const prisma = getPrismaClient();

/**
 * Workplan Generation Processor
 * Implements the complete workplan generation workflow from the Implementation Plan:
 * - Orchestrates multi-agent pipeline (Planner → Researcher → Strategist → Art Director → Document Builder)
 * - Handles both initial generation and regeneration scenarios
 * - Manages workplan document lifecycle (DRAFT → RESEARCHING → GENERATING → COMPLETED)
 */
const workplanGenerationProcessor = async (job) => {
  const startTime = Date.now();
  const {
    projectId,
    serviceType,
    documentId, // Optional - present if regeneration
    isRegeneration = false,
    regenerationReason,
    retryCount = 0,
    correlationId,
  } = job.data || {};

  logger.info(
    {
      jobId: job.id,
      projectId,
      serviceType,
      documentId,
      isRegeneration,
      regenerationReason,
      retryCount,
      correlationId,
    },
    "Starting workplan generation"
  );

  try {
    // Validate required fields
    if (!projectId) {
      throw new Error("projectId is required");
    }

    if (!isRegeneration && !serviceType) {
      throw new Error("serviceType is required for initial generation");
    }

    if (isRegeneration && !documentId) {
      throw new Error("documentId is required for regeneration");
    }

    // TODO: Phase 3 - Implement workplan generation logic
    // Step 1: Get or determine service type
    // Step 2: Create/update workplan document
    // Step 3: Run Agent A: Planner (TOC generation)
    // Step 4: Run Agent B: Researcher (per-slide research)
    // Step 5: Run Agent C: Strategist (content synthesis)
    // Step 6: Run Agent D: Art Director (design directives)
    // Step 7: Run Agent E: Document Builder (Google Docs assembly)
    // Step 8: Update document status to COMPLETED
    // Step 9: Create audit logs

    // Placeholder implementation - to be replaced in Phase 3
    logger.info(
      {
        jobId: job.id,
        projectId,
        serviceType,
        documentId,
        correlationId,
      },
      "Workplan generation processor - placeholder implementation"
    );

    // Create audit log for workplan generation start
    await prisma.auditLog.create({
      data: {
        projectId: projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: isRegeneration
          ? AuditActions.WORKPLAN_REGENERATION_REQUESTED
          : AuditActions.WORKPLAN_GENERATION_STARTED,
        details: {
          serviceType,
          documentId,
          isRegeneration,
          regenerationReason,
          retryCount,
          correlationId,
        },
        at: new Date(),
      },
    });

    const duration = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        projectId,
        serviceType,
        documentId,
        duration,
        correlationId,
      },
      "Workplan generation completed successfully (placeholder)"
    );

    return {
      success: true,
      projectId,
      serviceType,
      documentId,
      isRegeneration,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        jobId: job.id,
        projectId,
        serviceType,
        documentId,
        error: error.message,
        errorType: error.constructor.name,
        stack: error.stack,
        duration,
        correlationId,
      },
      "Workplan generation failed"
    );

    // Create audit log for failure
    try {
      await prisma.auditLog.create({
        data: {
          projectId: projectId,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action: AuditActions.WORKPLAN_GENERATION_FAILED,
          details: {
            serviceType,
            documentId,
            isRegeneration,
            error: error.message,
            errorType: error.constructor.name,
            retryCount,
            correlationId,
          },
          at: new Date(),
        },
      });
    } catch (auditError) {
      logger.error(
        {
          projectId,
          auditError: auditError.message,
          correlationId,
        },
        "Failed to create audit log for workplan generation failure"
      );
    }

    throw error;
  }
};

module.exports = {
  workplanGenerationProcessor,
};

