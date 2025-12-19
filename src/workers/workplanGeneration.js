const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { QueueService } = require("@/queues");
const { appConfig } = require("@/config");
const {
  DocumentType,
  DocumentStatus,
  SystemActors,
  AuditActions,
  SlideType,
  ResearchStatus,
  TeamRole,
  AsanaProjectBoardSections,
  ProjectPhase,
} = require("@/constants");
const {
  isValidProjectPhaseTransition,
} = require("@/utils/validation/commonValidation");
const { withTransaction } = require("@/database");
const {
  WorkplanPlannerService,
  WorkplanResearcherService,
  WorkplanStrategistService,
  WorkplanArtDirectorService,
  WorkplanDocumentBuilderService,
  EmailTemplateService,
} = require("@/services");
const { asanaIntegration } = require("@/integrations/asana");
const { brevoIntegration } = require("@/integrations/brevo");
const { googleIntegration } = require("@/integrations/google");
const {
  AsanaPendingProjectsService,
} = require("@/services/asanaPendingProjectsService");
const { generateUuid, retry } = require("@/utils");

const logger = createLogger("worker:workplanGeneration");
const prisma = getPrismaClient();
const { queues } = require("@/queues");

/**
 * Wait for intent detection job to complete and extract intent result
 * @param {string} intentJobId - Intent detection job ID
 * @param {string} correlationId - Correlation ID for logging
 * @returns {Promise<Object|null>} Intent result or null if job not found/failed
 */
async function waitForIntentDetection(intentJobId, correlationId) {
  try {
    if (!intentJobId) {
      return null;
    }

    logger.info(
      {
        intentJobId,
        correlationId,
      },
      "Waiting for intent detection job to complete"
    );

    const intentQueue = queues.feedbackIntent;
    const intentJob = await intentQueue.getJob(intentJobId);

    if (!intentJob) {
      logger.warn(
        {
          intentJobId,
          correlationId,
        },
        "Intent detection job not found"
      );
      return null;
    }

    // Wait for job to complete (with timeout)
    const intentResult = await Promise.race([
      intentJob.waitUntilFinished({ timeout: 120000 }), // 120 seconds (2 minutes) timeout
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Intent detection timeout")), 120000)
      ),
    ]);

    logger.info(
      {
        intentJobId,
        correlationId,
        intent: intentResult?.intent,
        confidence: intentResult?.confidence,
        requestedChangesCount: intentResult?.requestedChanges?.length || 0,
        slideReferencesCount:
          intentResult?.documentTypeAnalysis?.sectionReferences?.length || 0,
      },
      "Intent detection job completed"
    );

    // Extract intent result in the format expected by workers
    return {
      intent: intentResult?.intent || "DOC_FEEDBACK",
      confidence: intentResult?.confidence || 0.8,
      summary: intentResult?.summary || "",
      requestedChanges: intentResult?.requestedChanges || [],
      reasoning: intentResult?.reasoning || "",
      clientSentiment: intentResult?.clientSentiment || null,
      urgency: intentResult?.urgency || null,
      documentTypeAnalysis: intentResult?.documentTypeAnalysis || null,
    };
  } catch (error) {
    logger.error(
      {
        intentJobId,
        correlationId,
        error: error.message,
      },
      "Failed to wait for intent detection - will use fallback"
    );
    // Return null to use fallback (raw feedback)
    return null;
  }
}

/**
 * Format workplan feedback with structured intent for prompt enhancement
 * @param {Object} intentResult - Intent detection result
 * @param {string} rawFeedback - Original raw feedback text
 * @returns {string} Formatted feedback string for prompts
 */
function formatWorkplanFeedback(intentResult, rawFeedback) {
  let formatted = `## Regeneration Feedback Summary\n${
    intentResult.summary || rawFeedback
  }\n\n`;

  if (intentResult.requestedChanges?.length > 0) {
    formatted += `### Specific Changes Requested:\n`;
    intentResult.requestedChanges.forEach((change, idx) => {
      formatted += `${idx + 1}. ${
        change.section ? `[${change.section}] ` : ""
      }${change.change}`;
      if (change.priority) formatted += ` (Priority: ${change.priority})`;
      if (change.feasibility)
        formatted += ` (Complexity: ${change.feasibility})`;
      formatted += `\n`;
    });
  }

  // Add slide-specific targeting
  if (intentResult.documentTypeAnalysis?.sectionReferences?.length > 0) {
    formatted += `\n### Affected Slides:\n`;
    formatted += intentResult.documentTypeAnalysis.sectionReferences
      .map((ref) => `- ${ref}`)
      .join("\n");
  }

  // Add urgency/priority context
  if (intentResult.urgency) {
    formatted += `\n### Feedback Priority: ${intentResult.urgency.toUpperCase()}\n`;
  }

  return formatted;
}

// Note: For every initial creation or regenration, it creates a new Google Doc each time (not updating the existing one). The database reference is updated to the new document, so the old document remains in Google Drive but is no longer referenced.
/**
 * Workplan Generation Processor
 * Orchestrates multi-agent pipeline (Planner → Researcher → Strategist → Art Director → Document Builder)
 * Handles both initial generation and regeneration scenarios
 */
const workplanGenerationProcessor = async (job) => {
  if (job.name === "regenerate-slide") {
    return slideRegenerationProcessor(job);
  }

  const startTime = Date.now();
  const {
    projectId,
    serviceType: providedServiceType,
    documentId: providedDocumentId,
    isRegeneration = false,
    regenerationReason, // Raw text feedback (backward compatible)
    intentJobId, // New: for structured intent detection
    retryCount = 0,
    correlationId: providedCorrelationId,
  } = job.data || {};

  const correlationId = providedCorrelationId || generateUuid();

  // Wait for intent detection if provided (for enhanced structured feedback)
  let structuredIntent = null;
  if (isRegeneration && intentJobId) {
    structuredIntent = await waitForIntentDetection(intentJobId, correlationId);
  }

  // Build enhanced regeneration feedback
  // Supports both raw text (backward compatible) and structured intent (enhanced)
  let regenerationFeedback = regenerationReason || null;
  if (isRegeneration && structuredIntent) {
    // Enhance with structured intent while preserving raw text
    regenerationFeedback = {
      rawFeedback: regenerationReason, // Original text for fallback
      summary: structuredIntent.summary,
      requestedChanges: structuredIntent.requestedChanges || [],
      slideReferences:
        structuredIntent.documentTypeAnalysis?.sectionReferences || [],
      priority: structuredIntent.urgency || "medium",
      clientSentiment: structuredIntent.clientSentiment || null,
      // Format for prompt use
      formattedFeedback: formatWorkplanFeedback(
        structuredIntent,
        regenerationReason
      ),
    };

    logger.info(
      {
        documentId: providedDocumentId,
        requestedChangesCount: structuredIntent.requestedChanges?.length || 0,
        slideReferencesCount:
          structuredIntent.documentTypeAnalysis?.sectionReferences?.length || 0,
        correlationId,
      },
      "Using enhanced structured feedback for workplan regeneration"
    );
  } else if (isRegeneration && regenerationReason) {
    // Fallback: use raw text (backward compatible)
    logger.info(
      {
        documentId: providedDocumentId,
        correlationId,
      },
      "Using raw text feedback for workplan regeneration (intent detection not available)"
    );
  }

  logger.info(
    {
      jobId: job.id,
      projectId,
      providedServiceType,
      providedDocumentId,
      isRegeneration,
      regenerationReason,
      retryCount,
      correlationId,
    },
    "Starting workplan generation"
  );

  let documentId = providedDocumentId;
  let googleDocUrl = null;
  let slides = [];
  let serviceType = providedServiceType;
  let project;

  try {
    if (!projectId) {
      throw new Error("projectId is required");
    }

    if (isRegeneration && !providedDocumentId) {
      throw new Error("documentId is required for regeneration");
    }

    // Load project context
    project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        questionnaireResponses: {
          orderBy: { submittedAt: "desc" },
          take: 1,
        },
        documents: {
          where: {
            type: { in: [DocumentType.BRAND_ORIGIN, DocumentType.QUOTE] },
            status: { in: [DocumentStatus.ACCEPTED, DocumentStatus.COMPLETED] },
          },
          include: {
            revisions: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
        asanaLinks: true,
      },
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Determine service type once (uses cache)
    if (!serviceType) {
      serviceType = await WorkplanPlannerService.getServiceType(projectId);
    }

    const brandOrigin = project.documents.find(
      (d) => d.type === DocumentType.BRAND_ORIGIN
    );

    const context = {
      project,
      questionnaire: project.questionnaireResponses?.[0],
      brandOrigin: brandOrigin?.revisions?.[0],
      serviceType,
      regenerationFeedback, // Now enhanced with structured intent if available
    };

    // Agent A: Planner
    if (!isRegeneration) {
      const tocSlides = await WorkplanPlannerService.generateTOC(
        projectId,
        serviceType,
        context
      );

      // Fetch the newly created workplan document
      const workplanDoc = await prisma.document.findFirst({
        where: { projectId, type: DocumentType.WORKPLAN },
        orderBy: { createdAt: "desc" },
      });

      if (!workplanDoc) {
        throw new Error("Failed to create workplan document");
      }

      documentId = workplanDoc.id;

      // Persist slides
      const slideRecords = tocSlides.map((slide) => ({
        documentId,
        slideNumber: slide.slideNumber,
        slideType: slide.slideType,
        title: slide.title,
        requiresBigIdea: !!slide.requiresBigIdea,
        isOptional: !!slide.isOptional,
        metadataInfo: slide.researchQueries
          ? { researchQueries: slide.researchQueries }
          : {},
      }));

      if (slideRecords.length > 0) {
        await prisma.workplanSlide.createMany({
          data: slideRecords,
        });
      }
    } else {
      // Regeneration uses existing document and slides
      const existingDoc = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
          workplanSlides: { orderBy: { slideNumber: "asc" } },
        },
      });

      if (!existingDoc) {
        throw new Error(`Workplan document not found: ${documentId}`);
      }

      slides = existingDoc.workplanSlides || [];
      // regenerationFeedback already set above with enhanced structured intent if available
    }

    // Ensure we have slides loaded
    if (slides.length === 0) {
      slides = await prisma.workplanSlide.findMany({
        where: { documentId },
        orderBy: { slideNumber: "asc" },
      });
    }

    // Update document status to RESEARCHING
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.RESEARCHING,
        metadataInfo: {
          serviceType,
          regenerationReason: regenerationReason || null,
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: isRegeneration
          ? AuditActions.WORKPLAN_REGENERATION_REQUESTED
          : AuditActions.WORKPLAN_GENERATION_STARTED,
        details: {
          serviceType,
          documentId,
          regenerationReason: regenerationReason || null,
          correlationId,
        },
      },
    });

    // Agent B: Researcher (with retry)
    const researchResults = {};
    for (const slide of slides) {
      try {
        const result = await retry(
          () => WorkplanResearcherService.researchWithFallback(slide, context),
          3,
          1500
        );
        researchResults[slide.id] = result;
      } catch (error) {
        logger.error(
          { slideId: slide.id, error: error.message, correlationId },
          "Research step failed after retries"
        );
      }
    }

    // Refresh slides after research to get persisted data
    slides = await prisma.workplanSlide.findMany({
      where: { documentId },
      orderBy: { slideNumber: "asc" },
    });

    // Update document status to GENERATING
    await prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.GENERATING },
    });

    // Agent C: Strategist
    for (const slide of slides) {
      try {
        await retry(
          () =>
            WorkplanStrategistService.synthesizeSlideContent(
              slide,
              researchResults[slide.id],
              { ...context, documentId }
            ),
          2,
          1500
        );

        if (slide.slideType === SlideType.BIG_IDEA) {
          await WorkplanStrategistService.generateBigIdeaOptions(
            documentId,
            slide.id,
            { ...context, documentId }
          );
        }
      } catch (error) {
        logger.error(
          { slideId: slide.id, error: error.message, correlationId },
          "Strategist step failed"
        );
      }
    }

    // Refresh slides after content synthesis
    slides = await prisma.workplanSlide.findMany({
      where: { documentId },
      orderBy: { slideNumber: "asc" },
    });

    // Agent D: Art Director
    for (const slide of slides) {
      try {
        await retry(
          () =>
            WorkplanArtDirectorService.generateDesignDirectives(
              slide,
              slide.contentCopy,
              { ...context, documentId }
            ),
          2,
          1500
        );
      } catch (error) {
        logger.error(
          { slideId: slide.id, error: error.message, correlationId },
          "Art Director step failed"
        );
      }
    }

    // Agent E: Document Builder
    const buildResult = await WorkplanDocumentBuilderService.buildGoogleDoc(
      documentId
    );
    googleDocUrl = buildResult.googleDocUrl;

    // Final audit log
    await prisma.auditLog.create({
      data: {
        projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: AuditActions.WORKPLAN_GENERATION_COMPLETED,
        details: {
          documentId,
          googleDocUrl,
          slideCount: slides.length,
          correlationId,
        },
      },
    });

    // Transition project phase from WORKPLAN_GENERATION to FINALIZED
    await withTransaction(async (tx) => {
      const currentProject = await tx.project.findUnique({
        where: { id: projectId },
        select: { phase: true },
      });

      if (
        currentProject &&
        currentProject.phase === ProjectPhase.WORKPLAN_GENERATION
      ) {
        if (
          isValidProjectPhaseTransition(
            ProjectPhase.WORKPLAN_GENERATION,
            ProjectPhase.FINALIZED
          )
        ) {
          await tx.project.update({
            where: { id: projectId },
            data: {
              phase: ProjectPhase.FINALIZED,
              updatedAt: new Date(),
            },
          });

          // Log phase transition
          await tx.projectPhaseLog.create({
            data: {
              projectId,
              fromPhase: ProjectPhase.WORKPLAN_GENERATION,
              toPhase: ProjectPhase.FINALIZED,
              reason: "Workplan document generation completed successfully",
              actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
              at: new Date(),
            },
          });

          logger.info(
            {
              projectId,
              fromPhase: ProjectPhase.WORKPLAN_GENERATION,
              toPhase: ProjectPhase.FINALIZED,
              correlationId,
            },
            "Project phase transitioned to FINALIZED"
          );
        } else {
          logger.warn(
            {
              projectId,
              currentPhase: currentProject.phase,
              correlationId,
            },
            "Invalid phase transition from WORKPLAN_GENERATION to FINALIZED"
          );
        }
      } else {
        logger.warn(
          {
            projectId,
            currentPhase: currentProject?.phase,
            correlationId,
          },
          "Project not in WORKPLAN_GENERATION phase, skipping phase transition"
        );
      }
    });

    // Create Asana task for Creative Director
    const isUIRegeneration = job.data?.isUIRegeneration || false;
    await createWorkplanReviewTask(
      project,
      googleDocUrl,
      slides.length,
      correlationId,
      isUIRegeneration
    );

    // Send completion emails
    await sendCompletionEmail(
      project.id,
      project.asanaProjectGid,
      correlationId,
      googleDocUrl,
      slides.length,
      buildResult.driveFileId,
      isUIRegeneration
    );

    const duration = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        projectId,
        documentId,
        googleDocUrl,
        duration,
        correlationId,
      },
      "Workplan generation completed successfully"
    );

    return {
      success: true,
      projectId,
      documentId,
      serviceType,
      googleDocUrl,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        jobId: job.id,
        projectId,
        documentId,
        serviceType,
        error: error.message,
        errorType: error.constructor.name,
        stack: error.stack,
        duration,
        correlationId,
      },
      "Workplan generation failed"
    );

    if (documentId) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.FAILED },
      });
    }

    try {
      await prisma.auditLog.create({
        data: {
          projectId,
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
        },
      });
    } catch (auditError) {
      logger.error(
        { projectId, auditError: auditError.message, correlationId },
        "Failed to create audit log for workplan generation failure"
      );
    }

    // Notify admin on failure
    if (appConfig?.server?.adminEmail) {
      try {
        await brevoIntegration.sendTransactionalEmail({
          to: [appConfig.server.adminEmail],
          subject: `Workplan generation failed for project ${projectId}`,
          htmlContent: `
            <p>Workplan generation failed.</p>
            <ul>
              <li>Project ID: ${projectId}</li>
              <li>Document ID: ${documentId || "N/A"}</li>
              <li>Error: ${error.message}</li>
              <li>Correlation ID: ${correlationId}</li>
            </ul>
          `,
        });
      } catch (notifyError) {
        logger.error(
          { notifyError: notifyError.message, correlationId },
          "Failed to send failure notification email"
        );
      }
    }

    throw error;
  }
};

/**
 * Slide regeneration processor (handles single slide re-run)
 */
async function slideRegenerationProcessor(job) {
  const startTime = Date.now();
  const {
    documentId,
    slideId,
    regenerationReason = null,
    intentJobId, // For structured intent detection
    retryCount = 0,
    correlationId: providedCorrelationId,
  } = job.data || {};

  const correlationId = providedCorrelationId || generateUuid();

  // For slide regeneration, also check for intent detection
  let slideStructuredIntent = null;
  if (intentJobId) {
    slideStructuredIntent = await waitForIntentDetection(
      intentJobId,
      correlationId
    );
  }

  // Build enhanced regeneration feedback for slide regeneration
  let slideRegenerationFeedback = regenerationReason || null;
  if (slideStructuredIntent) {
    slideRegenerationFeedback = {
      rawFeedback: regenerationReason,
      summary: slideStructuredIntent.summary,
      requestedChanges: slideStructuredIntent.requestedChanges || [],
      slideReferences:
        slideStructuredIntent.documentTypeAnalysis?.sectionReferences || [],
      priority: slideStructuredIntent.urgency || "medium",
      formattedFeedback: formatWorkplanFeedback(
        slideStructuredIntent,
        regenerationReason
      ),
    };
  }

  logger.info(
    {
      jobId: job.id,
      documentId,
      slideId,
      regenerationReason,
      retryCount,
      correlationId,
    },
    "Starting slide regeneration"
  );

  let projectId;
  let serviceType;

  try {
    if (!documentId || !slideId) {
      throw new Error(
        "documentId and slideId are required for slide regeneration"
      );
    }

    const slide = await prisma.workplanSlide.findUnique({
      where: { id: slideId },
      include: { document: true },
    });

    if (!slide || !slide.document || slide.documentId !== documentId) {
      throw new Error("Slide not found for the provided documentId");
    }

    if (slide.document.type !== DocumentType.WORKPLAN) {
      throw new Error("Document is not a workplan");
    }

    const document = slide.document;
    projectId = document.projectId;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        questionnaireResponses: { orderBy: { submittedAt: "desc" }, take: 1 },
        documents: {
          where: {
            type: { in: [DocumentType.BRAND_ORIGIN, DocumentType.QUOTE] },
            status: { in: [DocumentStatus.ACCEPTED, DocumentStatus.COMPLETED] },
          },
          include: {
            revisions: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });

    if (!project) {
      throw new Error(`Project not found for workplan document ${documentId}`);
    }

    serviceType =
      document.metadataInfo?.serviceType ||
      (await WorkplanPlannerService.getServiceType(project.id));

    const brandOrigin = project.documents?.find(
      (d) => d.type === DocumentType.BRAND_ORIGIN
    );

    const context = {
      project,
      questionnaire: project.questionnaireResponses?.[0],
      brandOrigin: brandOrigin?.revisions?.[0],
      serviceType,
      regenerationFeedback: slideRegenerationFeedback,
      documentId,
    };

    // Mark document as generating while regeneration runs
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.GENERATING,
        metadataInfo: {
          ...(document.metadataInfo || {}),
          serviceType,
          regenerationReason,
          lastSlideRegenerationId: slideId,
          regeneratedAt: new Date().toISOString(),
        },
      },
    });

    // Re-run research (Agent B)
    let researchResult = null;
    try {
      researchResult = await WorkplanResearcherService.researchWithFallback(
        slide,
        context
      );
    } catch (error) {
      await prisma.workplanSlide.update({
        where: { id: slideId },
        data: { researchStatus: ResearchStatus.FAILED },
      });
      throw error;
    }

    let refreshedSlide = await prisma.workplanSlide.findUnique({
      where: { id: slideId },
    });

    // Re-run strategist (Agent C)
    try {
      await WorkplanStrategistService.synthesizeSlideContent(
        refreshedSlide,
        researchResult || refreshedSlide?.researchData,
        { ...context, documentId }
      );

      refreshedSlide = await prisma.workplanSlide.findUnique({
        where: { id: slideId },
      });

      if (refreshedSlide?.slideType === SlideType.BIG_IDEA) {
        await WorkplanStrategistService.generateBigIdeaOptions(
          documentId,
          slideId,
          { ...context, documentId }
        );
      }
    } catch (error) {
      await prisma.workplanSlide.update({
        where: { id: slideId },
        data: { contentStatus: ResearchStatus.FAILED },
      });
      throw error;
    }

    refreshedSlide = await prisma.workplanSlide.findUnique({
      where: { id: slideId },
    });

    // Re-run art director (Agent D)
    try {
      await WorkplanArtDirectorService.generateDesignDirectives(
        refreshedSlide,
        refreshedSlide?.contentCopy,
        { ...context, documentId }
      );
    } catch (error) {
      await prisma.workplanSlide.update({
        where: { id: slideId },
        data: { designStatus: ResearchStatus.FAILED },
      });
      throw error;
    }

    // Rebuild Google Doc (Agent E)
    const buildResult = await WorkplanDocumentBuilderService.buildGoogleDoc(
      documentId
    );
    const duration = Date.now() - startTime;

    await prisma.auditLog.create({
      data: {
        projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: AuditActions.WORKPLAN_GENERATION_COMPLETED,
        details: {
          documentId,
          slideId,
          regeneration: true,
          regenerationReason,
          googleDocUrl: buildResult?.googleDocUrl || null,
          duration,
          correlationId,
        },
      },
    });

    logger.info(
      {
        jobId: job.id,
        documentId,
        slideId,
        duration,
        correlationId,
      },
      "Slide regeneration completed successfully"
    );
    // TODO: When slide regeneration successsful, send email to person that took the action
    return {
      success: true,
      documentId,
      slideId,
      regenerationReason,
      googleDocUrl: buildResult?.googleDocUrl || null,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        jobId: job.id,
        documentId,
        slideId,
        projectId,
        serviceType,
        error: error.message,
        stack: error.stack,
        duration,
        correlationId,
      },
      "Slide regeneration failed"
    );

    if (documentId) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.FAILED },
      });
    }

    try {
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action: AuditActions.WORKPLAN_GENERATION_FAILED,
          details: {
            documentId,
            slideId,
            regeneration: true,
            regenerationReason,
            serviceType,
            retryCount,
            error: error.message,
            correlationId,
          },
        },
      });
    } catch (auditError) {
      logger.error(
        { projectId, auditError: auditError.message, correlationId },
        "Failed to create audit log for slide regeneration failure"
      );
    }

    throw error;
  }
}

/**
 * Create a workplan review task in Asana for the Creative Director
 * @param {boolean} isUIRegeneration - Whether this is a UI regeneration (vs email intent)
 */
async function createWorkplanReviewTask(
  project,
  googleDocUrl,
  slideCount,
  correlationId,
  isUIRegeneration = false
) {
  try {
    if (!project.asanaProjectGid) {
      logger.warn(
        { projectId: project.id, correlationId },
        "Asana project GID missing, skipping workplan review task creation"
      );
      return;
    }

    const asanaLink = await prisma.asanaLink.findFirst({
      where: { projectId: project.id },
    });

    const toDoSectionGid =
      asanaLink?.sections?.[AsanaProjectBoardSections.TO_DO];

    const creativeDirector = await getCreativeDirector(project.id);
    const dueOn = addBusinessDays(new Date(), 3);

    const taskTitle = isUIRegeneration
      ? "Review Workplan Document (Regenerated)"
      : "Review Workplan Document";
    const taskDescription = isUIRegeneration
      ? `Workplan manually regenerated from the UI with ${slideCount} slides.
      \n
      Link: ${googleDocUrl}`
      : `Workplan generated with ${slideCount} slides.
      \n
      Link: ${googleDocUrl}`;

    const task = await asanaIntegration.createTask(
      taskTitle,
      project.asanaProjectGid,
      toDoSectionGid,
      creativeDirector?.asanaUserGid || null,
      dueOn,
      taskDescription
    );

    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: AuditActions.WORKPLAN_GENERATION_COMPLETED,
        details: {
          taskGid: task?.gid,
          creativeDirectorId: creativeDirector?.id || null,
          googleDocUrl,
          slideCount,
          correlationId,
        },
      },
    });
  } catch (error) {
    logger.error(
      { projectId: project.id, error: error.message, correlationId },
      "Failed to create workplan review task"
    );
  }
}

/**
 * Send completion email to Admin, Manager (if any), and PM
 * @param {number} projectId - Project ID
 * @param {string} asanaProjectGid - Asana project GID
 * @param {string} correlationId - Correlation ID
 * @param {string} googleDocUrl - Google Doc URL
 * @param {number} slideCount - Number of slides
 * @param {string} driveFileId - Google Drive file ID for sharing
 * @param {boolean} isUIRegeneration - Whether this is a UI regeneration (vs email intent)
 */
async function sendCompletionEmail(
  projectId,
  asanaProjectGid,
  correlationId,
  googleDocUrl,
  slideCount,
  driveFileId,
  isUIRegeneration = false
) {
  try {
    logger.info(
      {
        projectId,
        correlationId,
      },
      "Requerying project to get all documents including workplan"
    );

    // Always requery project to get all latest documents including workplan and updated phase
    // The phase was updated to FINALIZED in a transaction before this function is called
    // This fresh query ensures we get the updated phase value and documents
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        documents: {
          where: {
            driveFileId: {
              not: null,
            },
            // Include accepted brand origin, accepted quote with selectedQuoteId, and completed workplan
            OR: [
              {
                type: DocumentType.BRAND_ORIGIN,
                status: DocumentStatus.ACCEPTED,
              },
              {
                type: DocumentType.QUOTE,
                status: DocumentStatus.ACCEPTED,
                selectedQuoteId: {
                  not: null,
                },
              },
              {
                type: DocumentType.WORKPLAN,
                status: DocumentStatus.COMPLETED,
              },
            ],
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    });

    if (!project) {
      logger.error(
        {
          projectId,
          correlationId,
        },
        "Project not found when sending completion email"
      );
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          action:
            AuditActions.WORKPLAN_GENERATION_COMPLETED_EMAIL_SEND_ATTEMPTED,
          details: {
            projectId,
            correlationId,
            reason:
              "Project not found when sending project initialization completion email",
          },
        },
      });
      return;
    }

    if (!project.client) {
      logger.error(
        {
          projectId,
          correlationId,
        },
        "Project has no associated client when sending completion email"
      );
      return;
    }

    logger.info(
      {
        projectId,
        asanaProjectGid,
        correlationId,
      },
      "Sending project initialization completion email"
    );

    // Build Asana project URL
    const asanaProjectUrl = `https://app.asana.com/1/${appConfig.asana.workspaceGid}/project/${asanaProjectGid}/`;

    // Get recipients: Admin, Manager (if any), and PM
    const recipients = [];

    // Get Admin
    if (appConfig.server.adminEmail) {
      const adminUser = await prisma.teamMember.findFirst({
        where: {
          email: appConfig.server.adminEmail,
          isActive: true,
        },
      });

      if (adminUser) {
        recipients.push({
          email: adminUser.email,
          name: adminUser.name,
          role: TeamRole.ADMIN,
        });
      } else {
        // Fallback: add admin email even if not in team members
        recipients.push({
          email: appConfig.server.adminEmail,
          name: "Admin",
          role: TeamRole.ADMIN,
        });
      }
    }

    // Get Manager (if any)
    const managerUsers = await prisma.teamMember.findMany({
      where: {
        isActive: true,
        roles: {
          array_contains: [
            {
              role: TeamRole.MANAGER,
            },
          ],
        },
      },
    });

    for (const manager of managerUsers) {
      recipients.push({
        email: manager.email,
        name: manager.name,
        role: TeamRole.MANAGER,
      });
    }

    // Get PM assigned to this project
    const pmUser = await AsanaPendingProjectsService.getPMUser(projectId);

    if (pmUser && pmUser.email) {
      recipients.push({
        email: pmUser.email,
        name: pmUser.name,
        role: TeamRole.PROJECT_MANAGER,
      });
    }

    if (recipients.length === 0) {
      logger.warn(
        {
          projectId,
          correlationId,
        },
        "No recipients found for project initialization completion email"
      );
      return;
    }

    // Share workplan document with all recipients (Admin, Managers, PM, Creative Director)
    if (driveFileId && googleDocUrl) {
      try {
        // Get Creative Director email (if not already in recipients)
        const creativeDirector = await getCreativeDirector(projectId);
        const allRecipientEmails = new Set(
          recipients.map((r) => r.email.toLowerCase())
        );

        // Add Creative Director if not already included
        if (creativeDirector && creativeDirector.email) {
          allRecipientEmails.add(creativeDirector.email.toLowerCase());
        }

        // Convert to array of recipient objects for sharing
        const shareRecipients = Array.from(allRecipientEmails).map((email) => ({
          email,
          role: "reader",
          options: { sendNotification: false },
        }));

        if (shareRecipients.length > 0) {
          await googleIntegration.shareDocument(driveFileId, shareRecipients);

          logger.info(
            {
              projectId,
              driveFileId,
              recipientCount: shareRecipients.length,
              recipients: shareRecipients.map((r) => r.email),
              correlationId,
            },
            "Workplan document shared with all completion email recipients"
          );
        }
      } catch (shareError) {
        logger.error(
          {
            projectId,
            driveFileId,
            error: shareError.message,
            correlationId,
          },
          "Failed to share workplan document with recipients (non-fatal)"
        );
        // Don't throw - this shouldn't fail the main workflow
      }
    }

    // Fetch Google Drive links for project documents
    // Include accepted brand origin, selected accepted quote, and completed workplan
    const projectDocuments = [];
    const processedDocumentIds = new Set(); // Track processed document IDs to prevent duplicates
    if (project.documents && project.documents.length > 0) {
      for (const doc of project.documents) {
        // Skip if this document has already been processed
        if (processedDocumentIds.has(doc.id)) {
          continue;
        }

        // Process accepted brand origin, accepted quote with selectedQuoteId, or completed workplan
        const isAcceptedBrandOrigin =
          doc.type === DocumentType.BRAND_ORIGIN &&
          doc.status === DocumentStatus.ACCEPTED;
        const isSelectedAcceptedQuote =
          doc.type === DocumentType.QUOTE &&
          doc.status === DocumentStatus.ACCEPTED &&
          doc.selectedQuoteId !== null;
        const isCompletedWorkplan =
          doc.type === DocumentType.WORKPLAN &&
          doc.status === DocumentStatus.COMPLETED;

        if (
          (isAcceptedBrandOrigin ||
            isSelectedAcceptedQuote ||
            isCompletedWorkplan) &&
          doc.driveFileId
        ) {
          try {
            const fileMetadata = await googleIntegration.getDocumentMetadata(
              doc.driveFileId
            );
            if (fileMetadata?.webViewLink) {
              projectDocuments.push({
                type: doc.type,
                status: doc.status,
                driveLink: fileMetadata.webViewLink,
              });
              processedDocumentIds.add(doc.id); // Mark this document as processed
            }
          } catch (driveError) {
            logger.warn(
              {
                projectId,
                documentId: doc.id,
                driveFileId: doc.driveFileId,
                error: driveError.message,
                correlationId,
              },
              "Failed to get Drive link for document"
            );
            // Continue with other documents even if one fails
          }
        }
      }
    }

    // Send separate emails based on recipient role
    // PM gets email without financials, Admin/Manager get email with financials

    const adminManagerRecipients = recipients.filter(
      (r) => r.role === TeamRole.ADMIN || r.role === TeamRole.MANAGER
    );
    const pmRecipients = recipients.filter(
      (r) => r.role === TeamRole.PROJECT_MANAGER
    );

    // Send emails to Admin/Manager (with financials)
    if (adminManagerRecipients.length > 0) {
      try {
        const emailTemplate =
          EmailTemplateService.generateProjectInitializationCompleteTemplate(
            project,
            asanaProjectUrl,
            projectDocuments,
            true, // includeFinancials = true
            isUIRegeneration
          );

        await brevoIntegration.sendTransactionalEmail({
          to: adminManagerRecipients.map((r) => r.email),
          subject: emailTemplate.subject,
          htmlContent: emailTemplate.htmlContent,
        });

        logger.info(
          {
            recipients: adminManagerRecipients.map((r) => r.email),
            includeFinancials: true,
            projectId,
            correlationId,
          },
          "Project initialization completion email sent to Admin/Manager"
        );
      } catch (emailError) {
        logger.error(
          {
            recipients: adminManagerRecipients.map((r) => r.email),
            emailError: emailError.message,
            projectId,
            correlationId,
          },
          "Failed to send project initialization completion email to Admin/Manager"
        );
        // Don't throw - this shouldn't fail the main workflow
      }
    }

    // Send email to PM (without financials)
    if (pmRecipients.length > 0) {
      try {
        const emailTemplate =
          EmailTemplateService.generateProjectInitializationCompleteTemplate(
            project,
            asanaProjectUrl,
            projectDocuments,
            false, // includeFinancials = false
            isUIRegeneration
          );

        await brevoIntegration.sendTransactionalEmail({
          to: pmRecipients.map((r) => r.email),
          subject: emailTemplate.subject,
          htmlContent: emailTemplate.htmlContent,
        });

        logger.info(
          {
            recipients: pmRecipients.map((r) => r.email),
            includeFinancials: false,
            projectId,
            correlationId,
          },
          "Project initialization completion email sent to PM (without financials)"
        );
      } catch (emailError) {
        logger.error(
          {
            recipients: pmRecipients.map((r) => r.email),
            emailError: emailError.message,
            projectId,
            correlationId,
          },
          "Failed to send project initialization completion email to PM"
        );
        // Don't throw - this shouldn't fail the main workflow
      }
    }

    // Send workplan completion email to Creative Director (with workplan link)
    if (googleDocUrl) {
      try {
        const creativeDirector = await getCreativeDirector(projectId);
        if (creativeDirector && creativeDirector.email) {
          const workplanTemplate =
            EmailTemplateService.generateWorkplanCompletionTemplate(
              project,
              googleDocUrl,
              slideCount ?? projectDocuments.length ?? 0,
              isUIRegeneration
            );

          await brevoIntegration.sendTransactionalEmail({
            to: [creativeDirector.email],
            subject: workplanTemplate.subject,
            htmlContent: workplanTemplate.htmlContent,
          });

          logger.info(
            {
              recipient: creativeDirector.email,
              projectId,
              correlationId,
            },
            "Workplan completion email sent to Creative Director"
          );
        }
      } catch (cdEmailError) {
        logger.error(
          {
            projectId,
            error: cdEmailError.message,
            correlationId,
          },
          "Failed to send workplan completion email to Creative Director"
        );
      }
    }

    // Create audit log for email notification
    await prisma.auditLog.create({
      data: {
        projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: AuditActions.WORKPLAN_GENERATION_COMPLETED_EMAIL_SEND_ATTEMPTED,
        details: {
          recipientsNotified: recipients.map((r) => r.email),
          adminManagerRecipients: adminManagerRecipients.map((r) => ({
            email: r.email,
            includeFinancials: true,
          })),
          pmRecipients: pmRecipients.map((r) => ({
            email: r.email,
            includeFinancials: false,
          })),
          documentsCount: projectDocuments.length,
          correlationId,
        },
      },
    });
  } catch (error) {
    logger.error(
      {
        projectId,
        error: error.message,
        correlationId,
      },
      "Failed to send project initialization completion email"
    );
    // Don't throw - this shouldn't fail the main workflow
  }
}

/**
 * Determine Creative Director (or fallback)
 */
async function getCreativeDirector(projectId) {
  const directors = await prisma.teamMember.findMany({
    where: {
      isActive: true,
      roles: {
        array_contains: [{ role: TeamRole.CREATIVE_DIRECTOR }],
      },
    },
  });

  const leadDirector =
    directors.find((member) =>
      (member.roles || []).some(
        (role) => role.role === TeamRole.CREATIVE_DIRECTOR && role.isLead
      )
    ) || directors[0];

  if (leadDirector) {
    return leadDirector;
  }

  // Fallback to PM
  const pms = await prisma.teamMember.findMany({
    where: {
      isActive: true,
      roles: { array_contains: [{ role: TeamRole.PROJECT_MANAGER }] },
    },
  });

  const leadPm =
    pms.find((member) =>
      (member.roles || []).some(
        (role) => role.role === TeamRole.PROJECT_MANAGER && role.isLead
      )
    ) || pms[0];

  return leadPm || null;
}

function addBusinessDays(startDate, businessDays) {
  const date = new Date(startDate);
  let added = 0;
  while (added < businessDays) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return date.toISOString().split("T")[0];
}

module.exports = {
  workplanGenerationProcessor,
  slideRegenerationProcessor,
};
