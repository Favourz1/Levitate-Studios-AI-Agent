const crypto = require("crypto");
const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { QuoteService } = require("@/services/quoteService");
const { QuotePromptService } = require("@/services/quotePromptService");
const { llmClient } = require("@/llm/client");
const { erpIntegration } = require("@/integrations/levitateStudiosErp");
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
 * Main Quote Processor
 * Routes to appropriate processor based on job name
 */
const quoteGenerationProcessor = async (job) => {
  const jobName = job.name;

  logger.info(
    {
      jobId: job.id,
      jobName,
      data: job.data,
    },
    "Processing quote job"
  );

  switch (jobName) {
    case "generate-quote":
      return await quoteGenerationProcessorImpl(job);
    case "update-quote":
      return await updateQuoteProcessor(job);
    default:
      logger.warn(
        {
          jobId: job.id,
          jobName,
        },
        "Unknown quote job name - defaulting to generation"
      );
      return await quoteGenerationProcessorImpl(job);
  }
};

/**
 * Quote Generation Processor Implementation
 * Handles full quote workflow: LLM → ERP → Drive → DB → Asana → Email
 */
const quoteGenerationProcessorImpl = async (job) => {
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
  if (
    appConfig.server.adminEmail &&
    appConfig.server.nodeEnv === "production"
  ) {
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

/**
 * Quote Update Processor
 * Handles quote updates based on client feedback
 * Updates the selected quote (main or variant) in ERP and creates new revision
 */
const updateQuoteProcessor = async (job) => {
  const startTime = Date.now();
  const {
    projectId,
    documentId,
    feedbackContext,
    intentResult,
    correlationId: jobCorrelationId,
  } = job.data || {};
  const correlationId = jobCorrelationId || crypto.randomUUID();

  if (!projectId || typeof projectId !== "number") {
    const message = "Quote update job missing valid projectId";
    logger.error({ jobId: job.id, projectId, correlationId }, message);
    throw new Error(message);
  }

  if (!documentId || typeof documentId !== "number") {
    const message = "Quote update job missing valid documentId";
    logger.error({ jobId: job.id, documentId, correlationId }, message);
    throw new Error(message);
  }

  logger.info(
    {
      jobId: job.id,
      projectId,
      documentId,
      correlationId,
    },
    "Starting quote update workflow"
  );

  try {
    // Step 1: Get document and verify it's a QUOTE document with selected quote
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        project: {
          include: {
            client: true,
            questionnaireResponses: {
              where: { processingStatus: "PROCESSED" },
              orderBy: { submittedAt: "desc" },
              take: 1,
            },
          },
        },
        lastSentRevision: true,
      },
    });

    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    if (document.type !== DocumentType.QUOTE) {
      throw new Error(
        `Document ${documentId} is not a QUOTE document (type: ${document.type})`
      );
    }

    if (!document.selectedQuoteId) {
      throw new Error(
        `Document ${documentId} does not have a selected quote ID. Cannot update quote without knowing which quote to update.`
      );
    }

    const selectedQuoteId = document.selectedQuoteId;
    logger.info(
      {
        documentId,
        selectedQuoteId,
        correlationId,
      },
      "Found selected quote ID for update"
    );

    // Step 2: Verify quote is not cancelled and get current quote details
    let quoteDetails = await erpIntegration.getQuotation(selectedQuoteId);

    if (quoteDetails.quotation_canceled) {
      logger.warn(
        {
          selectedQuoteId,
          latestCanceledId: quoteDetails.latest_canceled_id,
          correlationId,
        },
        "Selected quote is cancelled - will amend to create new draft"
      );
    }

    // Step 3: Get current quote items
    const currentQuoteItems = quoteDetails.items || [];
    if (!Array.isArray(currentQuoteItems) || currentQuoteItems.length === 0) {
      throw new Error(`Quote ${selectedQuoteId} has no items to update`);
    }

    logger.info(
      {
        selectedQuoteId,
        currentItemCount: currentQuoteItems.length,
        correlationId,
      },
      "Retrieved current quote items"
    );

    // Step 4: Assemble context for LLM quote update
    const context = await QuoteService.assembleQuoteContext(projectId);

    // Step 5: Generate updated quote items using LLM
    const updatePrompt = QuotePromptService.generateQuoteUpdatePrompt(
      currentQuoteItems,
      feedbackContext,
      intentResult,
      context
    );

    const quoteItemsSchema = QuotePromptService.generateQuoteItemsSchema();
    const updateResult = await llmClient.generateStructured(
      quoteItemsSchema,
      updatePrompt,
      {
        systemPrompt: QuotePromptService.generateSystemPrompt(context),
        projectId: document.project.id,
        clientName: document.project.client.name,
      },
      "generation"
    );

    if (
      !updateResult.data ||
      !Array.isArray(updateResult.data) ||
      updateResult.data.length === 0
    ) {
      throw new Error("LLM returned empty or invalid updated quote items");
    }

    const updatedQuoteItems = updateResult.data;
    logger.info(
      {
        documentId,
        selectedQuoteId,
        originalItemCount: currentQuoteItems.length,
        updatedItemCount: updatedQuoteItems.length,
        correlationId,
      },
      "Generated updated quote items from LLM"
    );

    // Step 6: Ensure all items exist in ERP (CRITICAL - must be done before update)
    const validatedQuoteItems = await QuoteService.ensureItemsExist(
      updatedQuoteItems
    );

    logger.info(
      {
        documentId,
        validatedItemCount: validatedQuoteItems.length,
        correlationId,
      },
      "All quote items validated in ERP"
    );

    // Step 7: Update or amend quote in ERP
    let finalQuoteId = selectedQuoteId;
    const customerName = await QuoteService.ensureCustomerExists(
      document.project.client
    );

    if (quoteDetails.quotation_canceled) {
      // Quote is cancelled - need to amend
      logger.info(
        {
          cancelledQuoteId: selectedQuoteId,
          latestCanceledId: quoteDetails.latest_canceled_id,
          correlationId,
        },
        "Amending cancelled quote to create new draft"
      );

      const amendData = {
        customer: customerName,
        items: validatedQuoteItems.map((item) => ({
          item_code: item.item_code,
          qty: item.qty || 1,
          rate: item.rate,
          description: item.description,
        })),
        transaction_date: new Date().toISOString().split("T")[0],
      };

      const amendResult = await erpIntegration.amendQuotation(
        quoteDetails.latest_canceled_id || selectedQuoteId,
        amendData
      );

      // CRITICAL: Response returns new quote ID in data.name
      finalQuoteId = amendResult.newQuoteId || amendResult.quoteId;
      if (!finalQuoteId) {
        throw new Error(
          "Amend quotation response missing new quote ID in data.name"
        );
      }

      logger.info(
        {
          cancelledQuoteId: selectedQuoteId,
          newQuoteId: finalQuoteId,
          correlationId,
        },
        "Quote amended successfully - using new quote ID"
      );
    } else {
      // Quote is draft - can update directly
      if (quoteDetails.docstatus !== 0) {
        throw new Error(
          `Cannot update quote with docstatus ${quoteDetails.docstatus}. Only draft quotes (docstatus: 0) can be updated.`
        );
      }

      logger.info(
        {
          quoteId: selectedQuoteId,
          correlationId,
        },
        "Updating draft quote in ERP"
      );

      const updateData = {
        items: validatedQuoteItems.map((item) => ({
          item_code: item.item_code,
          qty: item.qty || 1,
          rate: item.rate,
          description: item.description,
        })),
      };

      await erpIntegration.updateQuotation(selectedQuoteId, updateData);

      logger.info(
        {
          quoteId: selectedQuoteId,
          correlationId,
        },
        "Quote updated successfully in ERP"
      );
    }

    // Step 8: Download updated quote PDF
    const pdfBuffer = await erpIntegration.getQuotationPDF(finalQuoteId);
    if (!Buffer.isBuffer(pdfBuffer)) {
      throw new Error("PDF download did not return a buffer");
    }

    logger.info(
      {
        quoteId: finalQuoteId,
        pdfSize: pdfBuffer.length,
        correlationId,
      },
      "Downloaded updated quote PDF from ERP"
    );

    // Step 9: Upload PDF to Google Drive
    const documentsFolder = await googleIntegration.ensureDocumentsFolder();
    const pdfName =
      `QUOTE_${document.project.client.name}_${document.project.name}_${finalQuoteId}_UPDATED`.replace(
        /[^a-zA-Z0-9_-]/g,
        "_"
      );

    const driveFile = await googleIntegration.uploadFileFromBuffer(
      pdfBuffer,
      pdfName,
      "application/pdf",
      documentsFolder.id
    );

    logger.info(
      {
        quoteId: finalQuoteId,
        driveFileId: driveFile.id,
        correlationId,
      },
      "Uploaded updated quote PDF to Google Drive"
    );

    // Step 10: Create new document revision and update document
    const updateResult_db = await withTransaction(async (tx) => {
      // Create new revision
      const revisionPayload = {
        updatedAt: new Date().toISOString(),
        quoteId: finalQuoteId,
        previousQuoteId: selectedQuoteId,
        driveFile: {
          id: driveFile.id,
          name: driveFile.name,
          webViewLink: driveFile.webViewLink,
        },
        quoteItems: validatedQuoteItems,
        feedbackSummary: intentResult.summary,
        requestedChanges: intentResult.requestedChanges || [],
      };

      const revision = await tx.documentRevision.create({
        data: {
          documentId: documentId,
          driveRevisionId: driveFile.id,
          snapshotText: JSON.stringify(revisionPayload, null, 2),
          snapshotMd: revisionPayload,
          createdBy: CreatedBy.AGENT,
          summary: `Quote updated based on client feedback. ${
            intentResult.requestedChanges?.length || 0
          } changes requested.`,
          createdAt: new Date(),
        },
      });

      // Update document with new revision and selected quote ID (if amended)
      const updateData = {
        currentRevisionId: revision.id,
        lastSentRevisionId: revision.id, // Update last sent revision
        updatedAt: new Date(),
      };

      // If quote was amended, update selectedQuoteId to new quote ID
      if (finalQuoteId !== selectedQuoteId) {
        updateData.selectedQuoteId = finalQuoteId;
        // Also update driveFileId to new PDF
        updateData.driveFileId = driveFile.id;
      }

      await tx.document.update({
        where: { id: documentId },
        data: updateData,
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          projectId,
          actor: SystemActors.QUOTE_GENERATOR,
          action: AuditActions.QUOTE_REGENERATED,
          details: {
            documentId,
            previousQuoteId: selectedQuoteId,
            updatedQuoteId: finalQuoteId,
            wasAmended: finalQuoteId !== selectedQuoteId,
            itemCount: validatedQuoteItems.length,
            feedbackSummary: intentResult.summary,
            requestedChangesCount: intentResult.requestedChanges?.length || 0,
            correlationId,
          },
          at: new Date(),
        },
      });

      return {
        revisionId: revision.id,
        documentId,
        quoteId: finalQuoteId,
      };
    });

    // Step 11: Notify Finance Manager about quote update
    const financeUser =
      (await AsanaPendingProjectsService.getFinanceManager(projectId)) || null;

    if (financeUser?.email) {
      try {
        // Create action token for sending updated quote to client
        let sendToClientToken = null;
        try {
          if (financeUser.id) {
            const actionTokenResult = await ActionService.createActionToken(
              {
                action: ActionType.SEND_TO_CLIENT,
                documentId: documentId,
                projectId: projectId,
                userId: financeUser.id,
                userEmail: financeUser.email,
                userName: financeUser.name || "Finance Manager",
              },
              "24h" // Token valid for 24 hours
            );
            sendToClientToken = actionTokenResult.token;

            logger.debug(
              {
                documentId,
                quoteId: finalQuoteId,
                userId: financeUser.id,
                correlationId,
              },
              "Action token created for updated quote"
            );
          }
        } catch (tokenError) {
          logger.warn(
            {
              documentId,
              quoteId: finalQuoteId,
              error: tokenError.message,
              correlationId,
            },
            "Failed to create action token for updated quote - email will be sent without send button"
          );
        }

        const emailTemplate =
          EmailTemplateService.generateQuoteUpdateNotificationTemplate(
            document.project,
            {
              quoteId: finalQuoteId,
              previousQuoteId: selectedQuoteId,
              wasAmended: finalQuoteId !== selectedQuoteId,
              driveFile,
              feedbackSummary: intentResult.summary,
              requestedChanges: intentResult.requestedChanges || [],
              sendToClientToken,
            }
          );

        await brevoIntegration.sendTransactionalEmail({
          to: [financeUser.email],
          subject: emailTemplate.subject,
          htmlContent: emailTemplate.htmlContent,
          textContent: "",
          senderName: "Levitate Studios AI Agent",
          senderEmail: `noreply@${appConfig.emailDomain}`,
        });

        logger.info(
          {
            financeEmail: financeUser.email,
            quoteId: finalQuoteId,
            correlationId,
          },
          "Quote update notification sent to Finance Manager"
        );
      } catch (emailError) {
        logger.warn(
          {
            financeEmail: financeUser.email,
            error: emailError.message,
            correlationId,
          },
          "Failed to send quote update notification email"
        );
      }
    }

    // Step 12: Add Asana comment
    try {
      const moveResult = await AsanaPendingProjectsService.moveTaskToSection(
        projectId,
        AsanaPendingProjectsBoardSections.QUOTE_DOCUMENT_PHASE,
        { correlationId }
      );

      if (moveResult?.taskGid) {
        const financeMention =
          financeUser?.asanaUserGid && financeUser?.name
            ? `<a data-asana-gid="${financeUser.asanaUserGid}" data-asana-type="user">@${financeUser.name}</a>`
            : "Finance Manager";

        const commentHtml = `<body>
💼 <strong>Quote Updated Based on Client Feedback</strong>
The quote has been updated based on client feedback. ${
          intentResult.requestedChanges?.length || 0
        } changes were requested.

${financeMention} please review the updated quote via email sent to you and send to client if approved.
</body>`;

        await asanaIntegration.addTaskComment(moveResult.taskGid, commentHtml);

        logger.info(
          {
            projectId,
            taskGid: moveResult.taskGid,
            correlationId,
          },
          "Added Asana comment for quote update"
        );
      }
    } catch (asanaError) {
      logger.warn(
        {
          projectId,
          error: asanaError.message,
          correlationId,
        },
        "Failed to add Asana comment for quote update"
      );
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        jobId: job.id,
        projectId,
        documentId,
        previousQuoteId: selectedQuoteId,
        updatedQuoteId: finalQuoteId,
        wasAmended: finalQuoteId !== selectedQuoteId,
        duration,
        correlationId,
      },
      "Quote update workflow completed successfully"
    );

    return {
      success: true,
      projectId,
      documentId,
      previousQuoteId: selectedQuoteId,
      updatedQuoteId: finalQuoteId,
      wasAmended: finalQuoteId !== selectedQuoteId,
      processingTime: duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      {
        jobId: job.id,
        projectId,
        documentId,
        error: error.message,
        duration,
        correlationId,
      },
      "Quote update workflow failed"
    );

    await logQuoteUpdateFailure(
      projectId,
      documentId,
      correlationId,
      error.message
    );
    throw error;
  }
};

/**
 * Log quote update failures for observability
 */
async function logQuoteUpdateFailure(
  projectId,
  documentId,
  correlationId,
  message
) {
  try {
    await withTransaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          projectId,
          actor: SystemActors.QUOTE_GENERATOR,
          action: AuditActions.QUOTE_GENERATION_FAILED,
          details: {
            documentId,
            error: message,
            correlationId,
            updateType: "QUOTE_UPDATE",
          },
          at: new Date(),
        },
      });
    });
  } catch (logError) {
    logger.error(
      {
        projectId,
        documentId,
        correlationId,
        logError: logError.message,
      },
      "Failed to log quote update failure"
    );
  }
}

module.exports = {
  quoteGenerationProcessor,
  updateQuoteProcessor,
};
