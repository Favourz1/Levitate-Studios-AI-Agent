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
  TeamRole,
  AsanaProjectBoardSections,
} = require("@/constants");
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

/**
 * Workplan Generation Processor
 * Orchestrates multi-agent pipeline (Planner → Researcher → Strategist → Art Director → Document Builder)
 * Handles both initial generation and regeneration scenarios
 */
const workplanGenerationProcessor = async (job) => {
  const startTime = Date.now();
  const {
    projectId,
    serviceType: providedServiceType,
    documentId: providedDocumentId,
    isRegeneration = false,
    regenerationReason,
    retryCount = 0,
    correlationId: providedCorrelationId,
  } = job.data || {};

  const correlationId = providedCorrelationId || generateUuid();

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
      regenerationFeedback: regenerationReason || null,
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
      context.regenerationFeedback = regenerationReason || null;
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

    // Create Asana task for Creative Director
    await createWorkplanReviewTask(
      project,
      googleDocUrl,
      slides.length,
      correlationId
    );

    // Send completion emails
    await sendCompletionEmail(
      project.id,
      project.asanaProjectGid,
      correlationId
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
 * Create a workplan review task in Asana for the Creative Director
 */
async function createWorkplanReviewTask(
  project,
  googleDocUrl,
  slideCount,
  correlationId
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

    const task = await asanaIntegration.createTask(
      "Review Workplan Document",
      project.asanaProjectGid,
      toDoSectionGid,
      creativeDirector?.asanaUserGid || null,
      dueOn,
      `Workplan generated with ${slideCount} slides.
      \n
      Link: ${googleDocUrl}`
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
 */
async function sendCompletionEmail(projectId, asanaProjectGid, correlationId) {
  try {
    logger.info(
      {
        projectId,
        correlationId,
      },
      "Requerying project to get all documents including workplan"
    );

    // Always requery project to get all latest documents including workplan
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
          role: "Admin",
        });
      } else {
        // Fallback: add admin email even if not in team members
        recipients.push({
          email: appConfig.server.adminEmail,
          name: "Admin",
          role: "Admin",
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
        role: "Manager",
      });
    }

    // Get PM assigned to this project
    const pmUser = await AsanaPendingProjectsService.getPMUser(projectId);

    if (pmUser && pmUser.email) {
      recipients.push({
        email: pmUser.email,
        name: pmUser.name,
        role: "Project Manager",
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

    // Fetch Google Drive links for project documents
    // Include accepted brand origin, selected accepted quote, and completed workplan
    const projectDocuments = [];
    if (project.documents && project.documents.length > 0) {
      for (const doc of project.documents) {
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

    // Use projectWithDocuments if requeried, otherwise use original project
    const projectForEmail = projectWithDocuments || project;

    // Send emails to Admin/Manager (with financials)
    if (adminManagerRecipients.length > 0) {
      try {
        const emailTemplate =
          EmailTemplateService.generateProjectInitializationCompleteTemplate(
            project,
            asanaProjectUrl,
            projectDocuments,
            true // includeFinancials = true
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
            false // includeFinancials = false
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

    // Create audit log for email notification
    await prisma.auditLog.create({
      data: {
        projectId,
        actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
        action: "PROJECT_INIT_COMPLETION_EMAIL_SENT",
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
        at: new Date(),
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
};
