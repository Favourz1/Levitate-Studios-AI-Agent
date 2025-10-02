const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { llmClient } = require("@/llm/client");
const { z } = require("zod");
const {
  BrandOriginPromptService,
} = require("@/services/brandOriginPromptService");
const { googleIntegration } = require("@/integrations/google");
const { asanaIntegration } = require("@/integrations/asana");
const { EmailTemplateService } = require("@/services/emailTemplateService");
const { brevoIntegration } = require("@/integrations/brevo");
const {
  AsanaPendingProjectsService,
} = require("@/services/asanaPendingProjectsService");
const {
  ValidationError,
  LLMError,
  GoogleError,
  AsanaError,
} = require("@/utils/errors");

const logger = createLogger("worker:documentGeneration");
const prisma = getPrismaClient();
const { appConfig } = require("@/config");

/**
 * Brand Origin Document Generation Processor
 * Implements the complete Step 2 workflow from the Implementation Plan:
 * - Context assembly from questionnaire responses, client context, project context
 * - LLM workflow with plan → compose → self-check loop
 * - Google Drive document creation and storage
 * - Database record creation for document and revision
 * - Asana task movement and PM notification
 * - Email notification to PM with Review/Send buttons
 */
const brandOriginGenerationProcessor = async (job) => {
  const startTime = Date.now();
  const { projectId, dedupeKey, correlationId } = job.data;

  logger.info(
    {
      jobId: job.id,
      projectId,
      dedupeKey,
      correlationId,
    },
    "Starting brand origin document generation"
  );

  try {
    // Step 1: Assemble context from database
    const context = await assembleProjectContext(projectId);

    // Step 2: Generate brand origin document using LLM
    const brandOriginDocument = await generateBrandOriginWithLLM(context);

    // Step 3: Create Google Drive document and database records
    const documentResult = await createDocumentRecords(
      context.project.id,
      brandOriginDocument,
      correlationId
    );

    // Step 4: Update Asana task and add PM comment
    await updateAsanaWorkflow(context, documentResult, correlationId);

    // Step 5: Send PM notification email
    await sendPMAdminNotificationEmail(context, documentResult, correlationId);

    const duration = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        projectId,
        documentId: documentResult.documentId,
        googleDocId: documentResult.googleDocId,
        duration,
        correlationId,
      },
      "Brand origin document generation completed successfully"
    );

    return {
      success: true,
      documentId: documentResult.documentId,
      googleDocId: documentResult.googleDocId,
      webViewLink: documentResult.webViewLink,
      revisionId: documentResult.revisionId,
      processingTime: duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        jobId: job.id,
        projectId,
        error: error.message,
        errorType: error.constructor.name,
        duration,
        correlationId,
        stack: error.stack,
      },
      "Brand origin document generation failed"
    );

    // Update project status to indicate failure
    await markProjectGenerationFailed(projectId, error.message, correlationId);

    throw error;
  }
};

/**
 * Assemble complete context for brand origin generation
 * @param {number} projectId - Project ID
 * @returns {Object} Complete context including project, client, and questionnaire data
 */
async function assembleProjectContext(projectId) {
  try {
    // Get project with all related data
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        questionnaireResponses: {
          where: { processingStatus: "PROCESSED" },
          orderBy: { submittedAt: "desc" },
          take: 1,
        },
        asanaLinks: true,
        emailThreads: {
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!project) {
      throw new ValidationError(`Project not found: ${projectId}`);
    }

    if (
      !project.questionnaireResponses ||
      project.questionnaireResponses.length === 0
    ) {
      throw new ValidationError(
        `No processed questionnaire found for project: ${projectId}`
      );
    }

    const questionnaireResponse = project.questionnaireResponses[0];

    logger.info(
      {
        projectId,
        clientId: project.clientId,
        questionnaireResponseId: questionnaireResponse.id,
      },
      "Context assembled successfully"
    );

    return {
      project: {
        id: project.id,
        name: project.name,
        phase: project.phase,
        context: project.context,
        client: {
          id: project.client.id,
          name: project.client.name,
          primaryEmail: project.client.primaryEmail,
          context: project.client.context,
        },
      },
      questionnaireResponse: {
        id: questionnaireResponse.id,
        formId: questionnaireResponse.formId,
        responseId: questionnaireResponse.responseId,
        responses: questionnaireResponse.responses,
        respondentEmail: questionnaireResponse.respondentEmail,
        submittedAt: questionnaireResponse.submittedAt,
      },
      asanaLinks: project.asanaLinks[0] || null,
      emailThread: project.emailThreads[0] || null,
    };
  } catch (error) {
    logger.error(
      {
        projectId,
        error: error.message,
      },
      "Failed to assemble project context"
    );
    throw error;
  }
}

/**
 * Generate brand origin document using LLM with plan → compose → self-check workflow
 * @param {Object} context - Complete project context
 * @returns {Object} Generated brand origin document with metadata
 */
async function generateBrandOriginWithLLM(context) {
  try {
    // Generate LLM context using prompt service
    const llmContext = BrandOriginPromptService.generateLLMContext(
      context.project,
      context.questionnaireResponse
    );

    logger.info(
      {
        projectId: context.project.id,
        industry: llmContext.metadata.industry,
      },
      "Starting LLM brand origin generation"
    );

    // Step 1: Planning Phase - Analyze and plan the brand origin
    const planningSchema = z.object({
      marketAnalysis: z
        .string()
        .describe(
          "Analysis of the market landscape and competitive positioning"
        ),
      audienceProfile: z
        .string()
        .describe("Detailed profile of the target audience"),
      brandArchitecture: z
        .string()
        .describe("Strategic brand architecture and positioning"),
      strategicApproach: z
        .string()
        .describe("Strategic approach for brand development"),
      keyDifferentiators: z
        .array(z.string())
        .optional()
        .describe("Key differentiators from competitors"),
      executionNotes: z
        .string()
        .optional()
        .describe("Notes for execution and implementation"),
    });

    const planningResult = await llmClient.generateStructured(
      planningSchema,
      `Based on the client questionnaire and context, analyze the strategic landscape and plan the brand origin approach:\n\n${llmContext.userPrompt}`,
      llmContext.context,
      "planning"
    );

    logger.info(
      {
        projectId: context.project.id,
        planningTokens: planningResult.tokenUsage?.totalTokens,
      },
      "Brand origin document planning phase completed"
    );

    // Step 2: Generation Phase - Create the brand origin document
    const generationResult = await llmClient.generateText(
      llmContext.userPrompt,
      llmContext.context,
      "generation",
      4000 // Higher token limit for document generation
    );

    logger.info(
      {
        projectId: context.project.id,
        generationTokens: generationResult.tokenUsage?.totalTokens,
        documentLength: generationResult.text.length,
      },
      "Brand origin document generation phase completed"
    );

    // Step 3: Validation Phase - Self-check the generated document
    const validationSchema = z.object({
      overallScore: z.number().min(0).max(10),
      scores: z.object({
        strategicCoherence: z.number().min(0).max(10),
        questionnaireIntegration: z.number().min(0).max(10),
        creativeActionability: z.number().min(0).max(10),
        marketRelevance: z.number().min(0).max(10),
        culturalAuthenticity: z.number().min(0).max(10),
      }),
      strengths: z.array(z.string()),
      improvements: z.array(z.string()),
      approved: z.boolean(),
      recommendedRevisions: z.array(z.string()).optional(),
    });

    const validationResult = await llmClient.generateStructured(
      validationSchema,
      BrandOriginPromptService.generateValidationPrompt(
        generationResult.text,
        llmContext.context
      ),
      llmContext.context,
      "classification"
    );

    logger.info(
      {
        projectId: context.project.id,
        validationScore: validationResult.data.overallScore,
        approved: validationResult.data.approved,
        validationTokens: validationResult.tokenUsage?.totalTokens,
      },
      "Brand origin document validation phase completed"
    );

    // Step 4: Refinement (if needed)
    let finalDocument = generationResult.text;
    let refinementAttempts = 0;
    const maxRefinements = 2;

    while (
      !validationResult.data.approved &&
      refinementAttempts < maxRefinements
    ) {
      refinementAttempts++;

      logger.info(
        {
          projectId: context.project.id,
          attempt: refinementAttempts,
          improvements: validationResult.data.improvements,
        },
        "Performing Brand origin document refinement"
      );

      const refinementResult = await llmClient.generateText(
        BrandOriginPromptService.generateRefinementPrompt(
          finalDocument,
          validationResult.data.improvements,
          llmContext.context
        ),
        llmContext.context,
        "generation",
        4000
      );

      finalDocument = refinementResult.text;
    }

    return {
      document: finalDocument,
      planning: planningResult.data,
      validation: validationResult.data,
      metadata: {
        totalTokensUsed:
          (planningResult.tokenUsage?.totalTokens || 0) +
          (generationResult.tokenUsage?.totalTokens || 0) +
          (validationResult.tokenUsage?.totalTokens || 0),
        refinementAttempts,
        finalScore: validationResult.data.overallScore,
        approved:
          validationResult.data.approved ||
          refinementAttempts >= maxRefinements,
        traceIds: [
          planningResult.traceId,
          generationResult.traceId,
          validationResult.traceId,
        ],
      },
    };
  } catch (error) {
    logger.error(
      {
        projectId: context.project.id,
        error: error.message,
        errorType: error.constructor.name,
      },
      "LLM brand origin generation failed"
    );

    if (error instanceof LLMError) {
      throw error;
    }

    throw new LLMError(
      "brand-origin-generation",
      "generateBrandOriginWithLLM",
      error,
      {
        projectId: context.project.id,
      }
    );
  }
}

/**
 * Create Google Drive document and database records
 * Uses separate transactions to avoid timeout issues with Google API calls
 * @param {number} projectId - Project ID
 * @param {Object} brandOriginDocument - Generated brand origin document
 * @param {string} correlationId - Correlation ID for tracking
 * @returns {Object} Created document information
 */
async function createDocumentRecords(
  projectId,
  brandOriginDocument,
  correlationId
) {
  let documentRecord = null;
  let googleDoc = null;

  try {
    // Step 1: Quick database transaction to get project info and create initial document record
    documentRecord = await withTransaction(async (tx) => {
      // Get project and client info for document title
      const project = await tx.project.findUnique({
        where: { id: projectId },
        include: { client: true },
      });

      if (!project) {
        throw new Error(`Project with ID ${projectId} not found`);
      }

      // Create initial document record without Google Drive info
      const document = await tx.document.create({
        data: {
          projectId,
          type: "BRAND_ORIGIN",
          status: "DRAFT", // Initially in draft until Google Doc is created
          driveFileId: null, // Will be updated after Google Doc creation
          isVariant: false,
          variantIndex: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      logger.info(
        {
          projectId,
          documentId: document.id,
          correlationId,
        },
        "Initial document record created in database"
      );

      return {
        document,
        project,
        documentTitle: `Brand Origin - ${project.client.name}`,
      };
    });

    // Step 2: Create Google Drive document (outside transaction)
    let folderId = null;

    // Get or create documents folder using global config
    try {
      const documentsFolder = await googleIntegration.ensureDocumentsFolder();
      folderId = documentsFolder.id;
    } catch (folderError) {
      logger.warn(
        {
          projectId,
          error: folderError.message,
          correlationId,
        },
        "Failed to create/get documents folder, creating document in root"
      );
    }

    googleDoc = await googleIntegration.createDocument(
      documentRecord.documentTitle,
      brandOriginDocument.document,
      {
        folderId,
        makePublicReadable: false,
      }
    );

    logger.info(
      {
        projectId,
        googleDocId: googleDoc.id,
        correlationId,
      },
      "Google Drive document created successfully"
    );

    const pmUser = projectId
      ? await AsanaPendingProjectsService.getPMUser(projectId)
      : null;
    console.log("pmUser from createDocumentRecords", pmUser);
    // Share document with PM
    if (pmUser) {
      try {
        await googleIntegration.shareDocument(googleDoc.id, [
          {
            email: pmUser.email,
            role: "writer",
            options: {
              sendNotification: true,
            },
          },
        ]);

        logger.info(
          {
            projectId,
            googleDocId: googleDoc.id,
            pmEmail: pmUser.email,
            correlationId,
          },
          "Google Document shared with PM successfully"
        );
      } catch (shareError) {
        logger.warn(
          {
            projectId,
            googleDocId: googleDoc.id,
            error: shareError.message,
            correlationId,
          },
          "Failed to share document with PM, but continuing"
        );
      }
    }

    // Step 3: Quick database transaction to update with Google Drive info and create revision
    const finalResult = await withTransaction(async (tx) => {
      // Update document with Google Drive ID and move to PM_REVIEW status
      const updatedDocument = await tx.document.update({
        where: { id: documentRecord.document.id },
        data: {
          driveFileId: googleDoc.id,
          status: "PM_REVIEW", // Ready for PM review now that Google Doc exists
          updatedAt: new Date(),
        },
      });

      // Create document revision
      const revision = await tx.documentRevision.create({
        data: {
          documentId: documentRecord.document.id,
          driveRevisionId: null, // Google Docs manages revisions internally
          snapshotText: brandOriginDocument.document,
          snapshotMd: null,
          summary: `Initial brand origin document generated by AI agent. Score: ${brandOriginDocument.metadata.finalScore}/10`,
          createdBy: "AGENT",
          createdAt: new Date(),
        },
      });

      // Update document to point to current revision
      await tx.document.update({
        where: { id: documentRecord.document.id },
        data: { currentRevisionId: revision.id },
      });

      // Create audit log entry
      await tx.auditLog.create({
        data: {
          projectId,
          actor: "SYSTEM (Brand Origin Generator)",
          action: "BRAND_ORIGIN_CREATED",
          details: {
            documentId: documentRecord.document.id,
            googleDocId: googleDoc.id,
            aiScore: brandOriginDocument.metadata.finalScore,
            tokensUsed: brandOriginDocument.metadata.totalTokensUsed,
            refinementAttempts: brandOriginDocument.metadata.refinementAttempts,
            correlationId,
          },
          at: new Date(),
        },
      });

      logger.info(
        {
          projectId,
          documentId: documentRecord.document.id,
          revisionId: revision.id,
          googleDocId: googleDoc.id,
          correlationId,
        },
        "Document records created and updated successfully"
      );

      return {
        documentId: documentRecord.document.id,
        revisionId: revision.id,
        googleDocId: googleDoc.id,
        webViewLink: googleDoc.webViewLink,
        documentTitle: documentRecord.documentTitle,
      };
    });

    return finalResult;
  } catch (error) {
    logger.error(
      {
        projectId,
        error: error.message,
        correlationId,
        hasDocumentRecord: !!documentRecord,
        hasGoogleDoc: !!googleDoc,
      },
      "Failed to create document records"
    );

    // If we have a document record but Google Doc creation failed,
    // mark the document as failed in the database
    if (documentRecord && !googleDoc) {
      try {
        await withTransaction(async (tx) => {
          await tx.document.update({
            where: { id: documentRecord.document.id },
            data: {
              status: "DRAFT", // Keep in draft state on failure
              updatedAt: new Date(),
            },
          });

          // Log the failure in audit log
          await tx.auditLog.create({
            data: {
              projectId,
              actor: "SYSTEM (Brand Origin Generator)",
              action: "BRAND_ORIGIN_FAILED",
              details: {
                documentId: documentRecord.document.id,
                error: error.message,
                correlationId,
                stage: "google_doc_creation",
              },
              at: new Date(),
            },
          });
        });
        logger.info(
          {
            projectId,
            documentId: documentRecord.document.id,
            correlationId,
          },
          "Document record marked as failed due to Google API error"
        );
      } catch (updateError) {
        logger.error(
          {
            projectId,
            updateError: updateError.message,
            correlationId,
          },
          "Failed to update document status after Google API failure"
        );
      }
    }

    if (error instanceof GoogleError) {
      throw error;
    }

    throw new GoogleError(
      "Google integration error during createDocumentRecords",
      {
        originalError: error.message,
        projectId,
        correlationId,
      }
    );
  }
}

/**
 * Update Asana workflow - move task and add PM comment
 * @param {Object} context - Project context
 * @param {Object} documentResult - Created document information
 * @param {string} correlationId - Correlation ID for tracking
 */
async function updateAsanaWorkflow(context, documentResult, correlationId) {
  try {
    // Get pending projects configuration first
    const pendingProjectsConfig =
      await AsanaPendingProjectsService.ensureAsanaPendingProjectsBoard();

    if (!pendingProjectsConfig || !pendingProjectsConfig.sections) {
      throw new AsanaError(
        "updateAsanaWorkflow",
        new Error("Pending projects configuration not available"),
        { projectId: context.project.id }
      );
    }

    // Get the task GID from database instead of unreliable name matching
    // First, get the asanaLink for this project that matches the pending projects board
    const asanaLink = await prisma.asanaLink.findFirst({
      where: {
        projectId: context.project.id,
        pendingBoardGid: pendingProjectsConfig.projectGid,
      },
      include: {
        tasks: {
          orderBy: { createdAt: "desc" },
          take: 1, // Get the most recent task
        },
      },
    });

    if (!asanaLink || !asanaLink.tasks || asanaLink.tasks.length === 0) {
      logger.warn(
        {
          projectId: context.project.id,
          pendingProjectGid: pendingProjectsConfig.projectGid,
          correlationId,
        },
        "No Asana task found in database for this project - skipping Asana workflow update"
      );
      return;
    }

    const asanaTask = asanaLink.tasks[0]; // Get the most recent task

    if (!asanaTask || !asanaTask.taskGid) {
      logger.warn(
        {
          projectId: context.project.id,
          pendingProjectGid: pendingProjectsConfig.projectGid,
          correlationId,
        },
        "Project task not found in database - skipping Asana workflow update"
      );
      return;
    }

    // Validate that the task still exists in Asana before attempting to move it
    let taskExists = false;
    try {
      const projectTasks = await asanaIntegration.getProjectTasks(
        pendingProjectsConfig.projectGid
      );
      taskExists = projectTasks.some((task) => task.gid === asanaTask.taskGid);
    } catch (error) {
      logger.warn(
        {
          projectId: context.project.id,
          taskGid: asanaTask.taskGid,
          error: error.message,
          correlationId,
        },
        "Failed to verify task existence in Asana - proceeding with caution"
      );
      // Continue anyway, let the moveTaskToSection call fail if task doesn't exist
      taskExists = true;
    }

    if (!taskExists) {
      logger.warn(
        {
          projectId: context.project.id,
          taskGid: asanaTask.taskGid,
          correlationId,
        },
        "Task no longer exists in Asana - skipping move operation"
      );
      return;
    }

    // Get the target section GID
    const brandOriginSectionGid =
      pendingProjectsConfig.sections["Brand Origin Doc Phase"];

    if (!brandOriginSectionGid) {
      throw new AsanaError(
        "updateAsanaWorkflow",
        new Error("Brand Origin Doc Phase section not found in configuration"),
        {
          projectId: context.project.id,
          availableSections: Object.keys(pendingProjectsConfig.sections),
        }
      );
    }

    // Move task to "Brand Origin Doc Phase" section with all required parameters
    await asanaIntegration.moveTaskToSection(
      asanaTask.taskGid, // taskGid
      pendingProjectsConfig.projectGid, // projectGid
      brandOriginSectionGid // sectionGid
    );

    // Update the asanaTask record in database to reflect the new section
    try {
      await prisma.asanaTask.update({
        where: { id: asanaTask.id },
        data: {
          sectionName: "Brand Origin Doc Phase",
        },
      });
    } catch (updateError) {
      logger.warn(
        {
          projectId: context.project.id,
          asanaTaskId: asanaTask.id,
          updateError: updateError.message,
          correlationId,
        },
        "Failed to update asanaTask section in database - continuing anyway"
      );
    }

    logger.info(
      {
        projectId: context.project.id,
        taskGid: asanaTask.taskGid,
        projectGid: pendingProjectsConfig.projectGid,
        sectionGid: brandOriginSectionGid,
        correlationId,
      },
      "Task moved to Brand Origin Doc Phase successfully and database updated"
    );

    // Get PM user for @mention
    const pmUser = await AsanaPendingProjectsService.getPMUser(
      context.project.id
    );

    // Add comment with PM mention and document links
    // Prepare the comment content with both text and HTML versions
    const commentContent = `<body>
🎨 <strong>Brand Origin Document Created</strong>

The AI agent has successfully generated the brand origin document for <strong>${
      context.project.client.name
    }</strong>.

📄 <strong>Document:</strong> <a href="${
      documentResult.webViewLink
    }">View Brand Origin Document</a>

<strong>Next Steps:</strong>
<ol>
  <li>🔍 <strong>Review</strong> the document for accuracy and strategic alignment</li>
  <li>✏️ <strong>Edit</strong> directly in Google Docs if changes are needed</li>
  <li>📧 <strong>Send to Client from email notification</strong> when ready for client review</li>
</ol>

The document is currently in <strong>PM_REVIEW</strong> status and ready for PM review.

${
  pmUser && pmUser.asanaUserGid
    ? `<a data-asana-gid="${pmUser.asanaUserGid}" data-asana-type="user">@${pmUser.name}</a>`
    : "@PM"
} please review and proceed when ready.
</body>`;

    await asanaIntegration.addTaskComment(asanaTask.taskGid, commentContent);

    logger.info(
      {
        projectId: context.project.id,
        taskGid: asanaTask.taskGid,
        pmUserGid: pmUser?.asanaUserGid,
        correlationId,
      },
      "Asana workflow updated successfully"
    );
  } catch (error) {
    logger.error(
      {
        projectId: context.project.id,
        error: error.message,
        errorType: error.constructor.name,
        correlationId,
        stack: error.stack,
      },
      "Failed to update Asana workflow"
    );

    // Create audit log for Asana workflow failure
    try {
      await prisma.auditLog.create({
        data: {
          projectId: context.project.id,
          actor: "SYSTEM (Brand Origin Generator)",
          action: "ASANA_WORKFLOW_FAILED",
          details: {
            error: error.message,
            errorType: error.constructor.name,
            correlationId,
            stage: "brand_origin_asana_update",
          },
          at: new Date(),
        },
      });
    } catch (auditError) {
      logger.error(
        {
          projectId: context.project.id,
          auditError: auditError.message,
          correlationId,
        },
        "Failed to log Asana workflow failure to audit log"
      );
    }

    // Don't throw error - this shouldn't fail the entire job
    // Log the error but continue with the process
  }
}

/**
 * Send PM notification email with Review/Send buttons
 * @param {Object} context - Project context
 * @param {Object} documentResult - Created document information
 * @param {string} documentType - Type of document (BRAND_ORIGIN, BUDGET_TIMELINE, BUDGET_TIMELINE_VARIANT)
 * @param {string} correlationId - Correlation ID for tracking
 */
async function sendPMAdminNotificationEmail(
  context,
  documentResult,
  documentType,
  correlationId
) {
  try {
    // Get PM email address
    const pmUser = await AsanaPendingProjectsService.getPMUser(
      context.project.id
    );

    if (!pmUser || !pmUser.email) {
      logger.warn(
        {
          projectId: context.project.id,
          correlationId,
        },
        "No PM email found - skipping email notification"
      );
      return;
    }

    // Generate email template
    // TODO: Create generateBudgetTimelineNotificationTemplate and generateBudgetTimelineVariantNotificationTemplate in emailTemplateService.js
    const emailTemplate = (() => {
      switch (documentType) {
        case "BRAND_ORIGIN":
          return EmailTemplateService.generateBrandOriginNotificationTemplate(
            context.project,
            documentResult,
            context.emailThread
          );
        case "BUDGET_TIMELINE":
          return EmailTemplateService.generateBudgetTimelineNotificationTemplate(
            context.project,
            documentResult,
            context.emailThread
          );
        default:
          return EmailTemplateService.generateBudgetTimelineVariantNotificationTemplate(
            context.project,
            documentResult,
            context.emailThread
          );
      }
    })();

    await brevoIntegration.sendTransactionalEmail({
      to:
        appConfig.server.nodeEnv === "production"
          ? [pmUser.email, appConfig.server.adminEmail]
          : [pmUser.email],
      subject: emailTemplate.subject,
      htmlContent: emailTemplate.htmlContent,
      // Don't use reply-to for internal notifications
    });

    // Log the email in database
    if (context.emailThread) {
      await prisma.email.create({
        data: {
          threadId: context.emailThread.id,
          direction: "OUTBOUND",
          fromAddr: "ai-agent@levitate.ng",
          toAddr: pmUser.email,
          subject: emailTemplate.subject,
          htmlBody: emailTemplate.htmlContent,
          textBody: emailTemplate.subject, // Simplified text version
          rawHeaders: {}, // Add this - empty object for outbound emails
          brevoEventId: null, // Brevo will provide this
          receivedAt: new Date(),
          intent: "NONE",
          intentConfidence: 1.0,
          processed: true,
        },
      });
    }

    logger.info(
      {
        projectId: context.project.id,
        pmEmail: pmUser.email,
        correlationId,
      },
      "PM/Admin notification email sent successfully"
    );
  } catch (error) {
    logger.error(
      {
        projectId: context.project.id,
        error: error.message,
        errorType: error.constructor.name,
        correlationId,
        stack: error.stack,
      },
      "Failed to send PM/Admin notification email"
    );

    // Create audit log for email notification failure
    try {
      await prisma.auditLog.create({
        data: {
          projectId: context.project.id,
          actor: "SYSTEM (Brand Origin Generator)",
          action: "PM_ADMIN_NOTIFICATION_FAILED",
          details: {
            error: error.message,
            errorType: error.constructor.name,
            correlationId,
            stage: `${documentType.toLowerCase()}_email_notification`,
          },
          at: new Date(),
        },
      });
    } catch (auditError) {
      logger.error(
        {
          projectId: context.project.id,
          auditError: auditError.message,
          correlationId,
        },
        "Failed to log email notification failure to audit log"
      );
    }

    // Don't throw error - this shouldn't fail the entire job
    // Log the error but continue with the process
  }
}

/**
 * Mark project as failed for document generation
 * @param {number} projectId - Project ID
 * @param {string} errorMessage - Error message
 * @param {string} correlationId - Correlation ID for tracking
 */
async function markProjectGenerationFailed(
  projectId,
  errorMessage,
  correlationId
) {
  try {
    await prisma.auditLog.create({
      data: {
        projectId,
        actor: "SYSTEM (Brand Origin Generator)",
        action: "BRAND_ORIGIN_FAILED",
        details: {
          error: errorMessage,
          correlationId,
          timestamp: new Date().toISOString(),
        },
        at: new Date(),
      },
    });

    logger.info(
      {
        projectId,
        correlationId,
      },
      "Project marked as generation failed"
    );
  } catch (logError) {
    logger.error(
      {
        projectId,
        originalError: errorMessage,
        logError: logError.message,
        correlationId,
      },
      "Failed to log generation failure"
    );
  }
}

/**
 * Main document generation processor that handles different document types
 * Routes to appropriate generation logic based on job data
 */
const documentGenerationProcessor = async (job) => {
  const { documentType } = job.data;

  logger.info(
    {
      jobId: job.id,
      documentType,
      data: job.data,
    },
    "Processing document generation job"
  );

  switch (documentType) {
    case "BRAND_ORIGIN":
      return await brandOriginGenerationProcessor(job);

    default:
      // Handle other document types or fallback to generic generation
      logger.warn(
        {
          jobId: job.id,
          documentType,
        },
        "Unknown document type - using generic generation"
      );

      return {
        success: false,
        error: `Unknown document type: ${documentType}`,
      };
  }
};

module.exports = {
  documentGenerationProcessor,
  brandOriginGenerationProcessor,
};
