const crypto = require("crypto");
const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { QuoteService } = require("@/services/quoteService");
const {
  DocumentType,
  DocumentStatus,
  ProjectPhase,
  AuditActions,
  SystemActors,
  CreatedBy,
  AsanaPendingProjectsBoardSections,
  ActionType,
} = require("@/constants");
const {
  AsanaPendingProjectsService,
} = require("@/services/asanaPendingProjectsService");
const { EmailTemplateService } = require("@/services/emailTemplateService");
const { ActionService } = require("@/services/actionService");
const { brevoIntegration } = require("@/integrations/brevo");
const { googleIntegration } = require("@/integrations/google");
const { asanaIntegration } = require("@/integrations/asana");
const { appConfig } = require("@/config");

const prisma = getPrismaClient();
const logger = createLogger("worker:quoteGeneration");

/**
 * Quote Generation Processor
 * Handles full quote workflow: LLM → ERP → Drive → DB → Asana → Email
 */
const quoteGenerationProcessor = async (job) => {
  const startTime = Date.now();
  const {
    projectId,
    dedupeKey,
    correlationId: jobCorrelationId,
  } = job.data || {};
  const correlationId = jobCorrelationId || crypto.randomUUID();

  if (!projectId || typeof projectId !== "number") {
    const message = "Quote generation job missing valid projectId";
    logger.error({ jobId: job.id, projectId, correlationId }, message);
    throw new Error(message);
  }

  logger.info(
    {
      jobId: job.id,
      projectId,
      dedupeKey,
      correlationId,
    },
    "Starting quote generation workflow"
  );

  try {
    // Step 1: Assemble context and generate quote items
    const context = await QuoteService.assembleQuoteContext(projectId);
    const generatedQuoteItems = await QuoteService.generateQuoteItemsWithLLM(
      context
    );

    // Step 2: Ensure ERP entities exist and create quotes (main + variants)
    const customerName = await QuoteService.ensureCustomerExists(
      context.project.client
    );
    const validatedQuoteItems = await QuoteService.ensureItemsExist(
      generatedQuoteItems
    );

    const quoteCreationContext = {
      project: context.project,
      questionnaire: context.questionnaire,
      rateCard: context.rateCard,
    };

    const { mainQuoteId, variantIds } = await QuoteService.createQuotesViaERP(
      validatedQuoteItems,
      customerName,
      quoteCreationContext
    );

    // Step 3: Download and upload PDFs to Drive
    const quoteIdsForPdf = [mainQuoteId, ...variantIds];
    const pdfs = await QuoteService.downloadQuotePDFs(quoteIdsForPdf);
    const driveFiles = await QuoteService.uploadQuotePDFsToDrive(
      pdfs,
      context.project
    );

    const driveFileEntries = driveFiles
      .map((file, index) => {
        if (!file) return null;
        return {
          ...file,
          quoteId: file.quoteId || quoteIdsForPdf[index],
        };
      })
      .filter(Boolean);

    const mainDriveFile = driveFileEntries.find(
      (file) => file.quoteId === mainQuoteId
    );

    // Step 4: Create document + revision records and update phase
    const documentResult = await createQuoteDocumentRecords(
      {
        projectId,
        mainQuoteId,
        variantIds,
        driveFiles: driveFileEntries,
        quoteItems: validatedQuoteItems,
      },
      correlationId
    );

    // Fetch Finance Manager once for downstream actions
    const financeUser =
      (await AsanaPendingProjectsService.getFinanceManager(projectId)) || null;

    // Step 5: Share Drive docs with stakeholders (Finance)
    await shareQuoteDocumentsWithFinance(
      driveFileEntries,
      financeUser,
      correlationId
    );

    // Step 6: Update Pending Projects board task and leave comment
    await updateAsanaTaskForQuote(
      projectId,
      driveFileEntries,
      financeUser,
      context.project.client,
      mainQuoteId,
      correlationId
    );

    // Step 7: Notify Finance/Admin via email
    await sendQuoteNotifications(
      context.project,
      driveFileEntries,
      {
        mainQuoteId,
        variantQuoteIds: variantIds,
        totalItems: validatedQuoteItems.length,
      },
      financeUser,
      correlationId
    );

    const duration = Date.now() - startTime;
    logger.info(
      {
        jobId: job.id,
        projectId,
        documentId: documentResult.documentId,
        mainQuoteId,
        variantCount: variantIds.length,
        duration,
        correlationId,
      },
      "Quote generation workflow completed successfully"
    );

    return {
      success: true,
      projectId,
      documentId: documentResult.documentId,
      mainQuoteId,
      variantQuoteIds: variantIds,
      processingTime: duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      {
        jobId: job.id,
        projectId,
        error: error.message,
        duration,
        correlationId,
      },
      "Quote generation workflow failed"
    );

    await logQuoteGenerationFailure(projectId, correlationId, error.message);
    throw error;
  }
};

/**
 * Create document & revision records for quotes
 */
async function createQuoteDocumentRecords(params, correlationId) {
  const { projectId, mainQuoteId, variantIds, driveFiles, quoteItems } = params;

  return await withTransaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });

    if (!project) {
      throw new Error(
        `Project ${projectId} not found while creating documents`
      );
    }

    const document = await tx.document.create({
      data: {
        projectId,
        type: DocumentType.QUOTE,
        status: DocumentStatus.DRAFT,
        driveFileId: driveFiles.find((file) => file.quoteId === mainQuoteId)
          ?.driveFileId,
        erpQuoteId: mainQuoteId,
        erpVariantIds: variantIds,
        selectedQuoteId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const revisionPayload = {
      generatedAt: new Date().toISOString(),
      mainQuoteId,
      variantQuoteIds: variantIds,
      driveFiles,
      quoteItems,
    };

    const revision = await tx.documentRevision.create({
      data: {
        documentId: document.id,
        driveRevisionId: null,
        snapshotText: JSON.stringify(revisionPayload, null, 2),
        snapshotMd: revisionPayload,
        createdBy: CreatedBy.AGENT,
        summary: `Quote generated with ${quoteItems.length} line items`,
        createdAt: new Date(),
      },
    });

    await tx.document.update({
      where: { id: document.id },
      data: {
        currentRevisionId: revision.id,
      },
    });

    await tx.auditLog.create({
      data: {
        projectId,
        actor: SystemActors.QUOTE_GENERATOR,
        action: AuditActions.QUOTE_CREATED,
        details: {
          documentId: document.id,
          mainQuoteId,
          variantQuoteIds: variantIds,
          driveFiles,
          totalItems: quoteItems.length,
          correlationId,
        },
        at: new Date(),
      },
    });

    if (project.phase !== ProjectPhase.QUOTE_DOCUMENT) {
      await tx.project.update({
        where: { id: projectId },
        data: {
          phase: ProjectPhase.QUOTE_DOCUMENT,
          updatedAt: new Date(),
        },
      });

      await tx.projectPhaseLog.create({
        data: {
          projectId,
          fromPhase: project.phase,
          toPhase: ProjectPhase.QUOTE_DOCUMENT,
          actor: SystemActors.QUOTE_GENERATOR,
          reason: "Quote document generated",
          at: new Date(),
        },
      });
    }

    return {
      documentId: document.id,
      revisionId: revision.id,
      document,
    };
  });
}

/**
 * Share main quote Drive file with Finance Manager
 */
async function shareQuoteDocumentsWithFinance(
  driveFiles,
  financeUser,
  correlationId
) {
  if (!driveFiles?.length || !financeUser?.email) {
    return;
  }

  try {
    for (const driveFile of driveFiles) {
      await googleIntegration.shareDocument(driveFile.driveFileId, [
        {
          email: financeUser.email,
          role: "writer",
          options: { sendNotification: true },
        },
      ]);
    }

    logger.info(
      {
        financeEmail: financeUser.email,
        driveFileId: mainDriveFile.driveFileId,
        correlationId,
      },
      "Shared quote document with Finance Manager"
    );
  } catch (error) {
    logger.warn(
      {
        financeEmail: financeUser.email,
        driveFileId: mainDriveFile.driveFileId,
        error: error.message,
        correlationId,
      },
      "Failed to share quote document with Finance Manager"
    );
  }
}

/**
 * Move Asana task to Quote phase and add comment
 */
async function updateAsanaTaskForQuote(
  projectId,
  driveFiles,
  financeUser,
  client,
  mainQuoteId,
  correlationId
) {
  const moveResult = await AsanaPendingProjectsService.moveTaskToSection(
    projectId,
    AsanaPendingProjectsBoardSections.QUOTE_DOCUMENT_PHASE,
    { correlationId }
  );

  if (!moveResult?.taskGid) {
    return;
  }

  //   const mainFile =
  //     driveFiles.find((file) => file.quoteId === mainQuoteId) || driveFiles[0];
  //   const variantList = driveFiles
  //     .filter((file) => file && file !== mainFile)
  //     .map(
  //       (file, index) => `
  //         <li>
  //           Variant ${index + 1} (${file.quoteId}) -
  //           <a href="${file.webViewLink || "#"}">View PDF</a>
  //         </li>`
  //     )
  //     .join("");

  const financeMention =
    financeUser?.asanaUserGid && financeUser?.name
      ? `<a data-asana-gid="${financeUser.asanaUserGid}" data-asana-type="user">@${financeUser.name}</a>`
      : "Finance Manager";

  const commentHtml = `<body>
💼 <strong>Quote Document Ready for ${client?.name || "client"}</strong>
The AI agent generated the primary quote and variants. Review the PDFs below to select the best option for the client.

${financeMention} please check your email to review and send the selected quote to the client.
</body>`;

  try {
    await asanaIntegration.addTaskComment(moveResult.taskGid, commentHtml);
  } catch (error) {
    logger.warn(
      {
        projectId,
        taskGid: moveResult.taskGid,
        error: error.message,
        correlationId,
      },
      "Failed to add Asana quote comment"
    );
  }
}

/**
 * Send notification email to Finance/Admin with Send to Client buttons
 */
async function sendQuoteNotifications(
  project,
  driveFiles,
  quoteSummary,
  financeUser,
  correlationId
) {
  const recipients = new Set();
  let financeUserId = null;
  let adminUserId = null;

  // Get admin team member for action token creation
  if (financeUser?.email) {
    recipients.add(financeUser.email);
    financeUserId = financeUser.id;
  }

  // For admin, we need to find admin user ID in team_members table
  if (appConfig.server.adminEmail && appConfig.server.nodeEnv === "production") {
    recipients.add(appConfig.server.adminEmail);
    // Fetch admin team member ID from database
    try {
      const adminTeamMember = await prisma.teamMember.findUnique({
        where: { email: appConfig.server.adminEmail },
        select: { id: true },
      });
      if (adminTeamMember) {
        adminUserId = adminTeamMember.id;
      }
    } catch (error) {
      logger.warn(
        { adminEmail: appConfig.server.adminEmail, error: error.message },
        "Failed to fetch admin team member ID"
      );
    }
  }

  if (recipients.size === 0) {
    logger.warn(
      { projectId: project.id, correlationId },
      "No recipients available for quote notification email"
    );
    return;
  }

  // Get the document to use its ID for action tokens
  const document = await prisma.document.findFirst({
    where: {
      projectId: project.id,
      type: DocumentType.QUOTE,
    },
    select: { id: true },
  });

  if (!document) {
    logger.warn(
      { projectId: project.id, correlationId },
      "No QUOTE document found for creating action tokens"
    );
    // Still send email, just without buttons
    const template = EmailTemplateService.generateQuoteNotificationTemplate(
      project,
      {
        mainQuoteId: quoteSummary.mainQuoteId,
        variantQuoteIds: quoteSummary.variantQuoteIds,
        driveFiles,
        totalItems: quoteSummary.totalItems,
        sendToClientTokens: {},
      }
    );

    await brevoIntegration.sendTransactionalEmail({
      to: Array.from(recipients),
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: "",
      senderName: "Levitate Studios AI Agent",
      senderEmail: `noreply@${appConfig.emailDomain}`,
    });

    logger.info(
      {
        projectId: project.id,
        recipients: Array.from(recipients),
        correlationId,
      },
      "Quote notification email sent (without action tokens)"
    );
    return;
  }

  // Create action tokens for each quote variant
  const allQuoteIds = [
    quoteSummary.mainQuoteId,
    ...quoteSummary.variantQuoteIds,
  ];
  const sendToClientTokens = {};

  try {
    for (const quoteId of allQuoteIds) {
      // Use finance user if available, otherwise admin user, otherwise skip token creation
      const userId = financeUserId || adminUserId;
      const userEmail = financeUser?.email || appConfig.server.adminEmail;

      if (!userId || !userEmail) {
        logger.warn(
          { quoteId, correlationId },
          "Cannot create action token: no valid user ID or email"
        );
        continue;
      }

      const actionTokenResult = await ActionService.createActionToken(
        {
          action: ActionType.SEND_TO_CLIENT,
          documentId: document.id,
          projectId: project.id,
          userId,
          userEmail,
          userName: financeUser?.name || "Admin",
        },
        "24h" // Token valid for 24 hours
      );

      sendToClientTokens[quoteId] = actionTokenResult.token;

      logger.debug(
        {
          quoteId,
          documentId: document.id,
          userId,
          correlationId,
        },
        "Action token created for quote"
      );
    }
  } catch (tokenError) {
    logger.error(
      {
        projectId: project.id,
        documentId: document.id,
        error: tokenError.message,
        correlationId,
      },
      "Failed to create action tokens for quotes"
    );
    // Continue without tokens - email will still be sent
  }

  const template = EmailTemplateService.generateQuoteNotificationTemplate(
    project,
    {
      mainQuoteId: quoteSummary.mainQuoteId,
      variantQuoteIds: quoteSummary.variantQuoteIds,
      driveFiles,
      totalItems: quoteSummary.totalItems,
      sendToClientTokens,
    }
  );

  await brevoIntegration.sendTransactionalEmail({
    to: Array.from(recipients),
    subject: template.subject,
    htmlContent: template.htmlContent,
    textContent: "",
    senderName: "Levitate Studios AI Agent",
    senderEmail: `noreply@${appConfig.emailDomain}`,
  });

  logger.info(
    {
      projectId: project.id,
      recipients: Array.from(recipients),
      tokensCreated: Object.keys(sendToClientTokens).length,
      correlationId,
    },
    "Quote notification email sent"
  );
}

/**
 * Log quote generation failures for observability
 */
async function logQuoteGenerationFailure(projectId, correlationId, message) {
  try {
    await withTransaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          projectId,
          actor: SystemActors.QUOTE_GENERATOR,
          action: AuditActions.QUOTE_GENERATION_FAILED,
          details: {
            error: message,
            correlationId,
          },
          at: new Date(),
        },
      });
    });
  } catch (logError) {
    logger.error(
      {
        projectId,
        correlationId,
        logError: logError.message,
      },
      "Failed to log quote generation failure"
    );
  }
}

module.exports = {
  quoteGenerationProcessor,
};
