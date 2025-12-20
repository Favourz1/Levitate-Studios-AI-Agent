const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { retry } = require("@/utils");
const { llmClient } = require("@/llm/client");
const { z } = require("zod");
const { ValidationError, LLMError } = require("@/utils/errors");
const { googleIntegration } = require("@/integrations/google");
const { IntentPromptService } = require("@/services/intentPromptService");
const { EmailTemplateService } = require("@/services/emailTemplateService");
const { brevoIntegration } = require("@/integrations/brevo");
const {
  AsanaPendingProjectsService,
} = require("@/services/asanaPendingProjectsService");
const { ActionService } = require("@/services/actionService");
const {
  EmailIntent,
  DocumentStatus,
  ProjectPhase,
  AuditActions,
  DocumentType,
  ActionType,
  SystemActors,
  AsanaPendingProjectsBoardSections,
} = require("@/constants");
const { QueueService } = require("@/queues");
const { appConfig } = require("@/config");
const {
  isValidProjectPhaseTransition,
} = require("@/utils/validation/commonValidation");
const { QuoteService } = require("@/services/quoteService");
const { erpIntegration } = require("@/integrations/levitateStudiosErp");

const logger = createLogger("worker:emailIntent");
const prisma = getPrismaClient();

/**
 * Email Intent Detection Worker
 * Analyzes inbound emails to detect client intent and determine appropriate actions
 * Implements Step 4 and Step 6 from the Implementation Plan
 */

/**
 * Assemble context for intent detection
 * @param {number} emailId - Email ID to analyze
 * @returns {Promise<Object>} Complete context for LLM
 */
async function assembleIntentContext(emailId) {
  try {
    // Get email with all related data
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: {
        thread: {
          include: {
            project: {
              include: {
                client: true,
                documents: {
                  where: {
                    status: {
                      in: [
                        DocumentStatus.SENT_TO_CLIENT,
                        DocumentStatus.CLIENT_FEEDBACK,
                      ],
                    },
                  },
                  orderBy: { updatedAt: "desc" },
                  take: 10, // Get more documents to filter by type
                  include: {
                    currentRevision: true,
                    lastSentRevision: true,
                  },
                },
                questionnaireResponses: {
                  orderBy: { submittedAt: "desc" },
                  take: 1,
                },
              },
            },
            emails: {
              where: {
                id: { not: emailId }, // Exclude current email
              },
              orderBy: { receivedAt: "desc" },
              take: 10, // Last 10 emails for context
            },
          },
        },
      },
    });

    if (!email) {
      throw new ValidationError(`Email not found: ${emailId}`);
    }

    if (!email.thread || !email.thread.project) {
      throw new ValidationError(
        `Email ${emailId} has no associated thread or project`
      );
    }

    const project = email.thread.project;

    // Determine expected document type based on project phase
    let expectedDocumentType = null;
    if (project.phase === ProjectPhase.QUOTE_DOCUMENT) {
      expectedDocumentType = DocumentType.QUOTE;
    } else if (project.phase === ProjectPhase.BRAND_ORIGIN) {
      expectedDocumentType = DocumentType.BRAND_ORIGIN;
    }

    // Filter documents by type if we know the expected type
    let currentDocument = null;
    if (expectedDocumentType && project.documents.length > 0) {
      // Find document matching the expected type
      currentDocument =
        project.documents.find(
          (doc) =>
            doc.type === expectedDocumentType &&
            (doc.status === DocumentStatus.SENT_TO_CLIENT ||
              doc.status === DocumentStatus.CLIENT_FEEDBACK)
        ) || null;
    } else {
      // Fallback: use first document if no type filter needed
      currentDocument = project.documents[0] || null;
    }

    // If still no document found, try a more permissive query
    if (!currentDocument) {
      logger.warn(
        {
          emailId,
          projectId: project.id,
          projectPhase: project.phase,
          expectedDocumentType,
          foundDocuments: project.documents.length,
          documentStatuses: project.documents.map((d) => ({
            id: d.id,
            type: d.type,
            status: d.status,
          })),
        },
        "No document found with expected type/status, trying broader query"
      );

      // Query directly from database with broader criteria
      const broaderQuery = await prisma.document.findFirst({
        where: {
          projectId: project.id,
          ...(expectedDocumentType && { type: expectedDocumentType }),
          status: {
            in: [
              DocumentStatus.SENT_TO_CLIENT,
              DocumentStatus.CLIENT_FEEDBACK,
              DocumentStatus.PM_REVIEW, // Also check PM_REVIEW as fallback for brand origin
              DocumentStatus.FINANCE_MANAGER_REVIEW, // Also check FINANCE_MANAGER_REVIEW as fallback for quote
            ],
          },
        },
        orderBy: { updatedAt: "desc" },
        include: {
          currentRevision: true,
          lastSentRevision: true,
        },
      });

      if (broaderQuery) {
        currentDocument = broaderQuery;
        logger.info(
          {
            emailId,
            projectId: project.id,
            documentId: currentDocument.id,
            documentType: currentDocument.type,
            documentStatus: currentDocument.status,
          },
          "Found document with broader query"
        );
      }
    }

    const conversationHistory = email.thread.emails || [];

    // Get the content that was actually sent to the client
    let sentDocumentContent = null;
    let sentContentSource = "none";

    if (currentDocument?.lastSentRevision) {
      const lastSentRevision = currentDocument.lastSentRevision;

      // Check if this is a PDF revision with source revision
      const snapshotMd = lastSentRevision.snapshotMd;
      const hasPdfFileId = snapshotMd?.pdfFileId;
      const sourceRevisionId = snapshotMd?.sourceRevisionId;

      if (hasPdfFileId && sourceRevisionId) {
        // This is a PDF revision - get content from source revision
        try {
          const sourceRevision = await prisma.documentRevision.findUnique({
            where: { id: sourceRevisionId },
          });

          if (sourceRevision?.snapshotText) {
            sentDocumentContent = sourceRevision.snapshotText;
            sentContentSource = "source_revision";

            logger.info(
              {
                emailId,
                documentId: currentDocument.id,
                lastSentRevisionId: lastSentRevision.id,
                sourceRevisionId,
              },
              "Using source revision content for PDF-based sent document"
            );
          } else {
            // Source revision not found or has no content - fallback to Google Drive
            logger.warn(
              {
                emailId,
                documentId: currentDocument.id,
                sourceRevisionId,
              },
              "Source revision not found or empty, fetching from Google Drive"
            );

            if (currentDocument.driveFileId) {
              sentDocumentContent =
                await googleIntegration.exportDocumentAsText(
                  currentDocument.driveFileId
                );
              sentContentSource = "google_drive_fallback";
            }
          }
        } catch (error) {
          logger.error(
            {
              emailId,
              documentId: currentDocument.id,
              sourceRevisionId,
              error: error.message,
            },
            "Failed to get source revision content, trying Google Drive fallback"
          );

          // Final fallback to Google Drive
          if (currentDocument.driveFileId) {
            try {
              sentDocumentContent =
                await googleIntegration.exportDocumentAsText(
                  currentDocument.driveFileId
                );
              sentContentSource = "google_drive_error_fallback";
            } catch (driveError) {
              logger.error(
                {
                  emailId,
                  documentId: currentDocument.id,
                  driveError: driveError.message,
                },
                "Failed to get content from Google Drive, using last sent revision snapshot"
              );
              sentDocumentContent = lastSentRevision.snapshotText;
              sentContentSource = "last_sent_snapshot_fallback";
            }
          } else {
            sentDocumentContent = lastSentRevision.snapshotText;
            sentContentSource = "last_sent_snapshot_no_drive";
          }
        }
      } else if (!hasPdfFileId && !sourceRevisionId) {
        // This is a regular Google Docs revision (edge case)
        sentDocumentContent = lastSentRevision.snapshotText;
        sentContentSource = "google_docs_revision";

        logger.info(
          {
            emailId,
            documentId: currentDocument.id,
            lastSentRevisionId: lastSentRevision.id,
          },
          "Using Google Docs revision content (edge case)"
        );
      } else {
        // Partial metadata - handle gracefully
        logger.warn(
          {
            emailId,
            documentId: currentDocument.id,
            hasPdfFileId,
            hasSourceRevisionId: !!sourceRevisionId,
          },
          "Incomplete revision metadata, using snapshot text"
        );
        sentDocumentContent = lastSentRevision.snapshotText;
        sentContentSource = "incomplete_metadata_fallback";
      }
    } else if (currentDocument?.currentRevision) {
      // No last sent revision - use current revision (shouldn't happen in normal flow)
      sentDocumentContent = currentDocument.currentRevision.snapshotText;
      sentContentSource = "current_revision_fallback";

      logger.warn(
        {
          emailId,
          documentId: currentDocument.id,
        },
        "No last sent revision found, using current revision (unusual case)"
      );
    }

    logger.info(
      {
        emailId,
        projectId: project.id,
        projectPhase: project.phase,
        hasCurrentDocument: !!currentDocument,
        conversationHistoryLength: conversationHistory.length,
        sentContentSource,
        sentContentLength: sentDocumentContent?.length || 0,
      },
      "Intent context assembled successfully"
    );

    return {
      email: {
        id: email.id,
        from: email.fromAddr,
        subject: email.subject,
        textBody: email.textBody,
        htmlBody: email.htmlBody,
        receivedAt: email.receivedAt,
      },
      project: {
        id: project.id,
        name: project.name,
        phase: project.phase,
        client: {
          id: project.client.id,
          name: project.client.name,
          email: project.client.primaryEmail,
        },
      },
      currentDocument: currentDocument
        ? {
            id: currentDocument.id,
            type: currentDocument.type,
            status: currentDocument.status,
            content: currentDocument.currentRevision?.snapshotText || null,
            sentContent: sentDocumentContent,
            sentContentSource,
            lastSentRevisionId: currentDocument.lastSentRevisionId,
          }
        : null,
      conversationHistory: conversationHistory.map((e) => ({
        direction: e.direction,
        from: e.fromAddr,
        subject: e.subject,
        textBody: e.textBody,
        receivedAt: e.receivedAt,
        intent: e.intent,
      })),
      questionnaireContext: project.questionnaireResponses[0]
        ? {
            responses: project.questionnaireResponses[0].responses,
            submittedAt: project.questionnaireResponses[0].submittedAt,
          }
        : null,
    };
  } catch (error) {
    logger.error(
      {
        emailId,
        error: error.message,
      },
      "Failed to assemble intent context"
    );
    throw error;
  }
}

/**
 * Detect email intent using LLM
 * @param {Object} context - Complete email context
 * @returns {Promise<Object>} Detected intent with confidence and details
 */
async function detectEmailIntent(context) {
  try {
    logger.info(
      {
        emailId: context.email.id,
        projectPhase: context.project.phase,
        hasDocument: !!context.currentDocument,
      },
      "Starting LLM intent detection"
    );

    // Build system context for LLM
    const systemContext = {
      projectPhase: context.project.phase,
      documentType: context.currentDocument?.type,
      documentStatus: context.currentDocument?.status,
      conversationLength: context.conversationHistory.length,
    };

    // Build unified prompt with type-specific awareness and preserved client context
    const basePrompt = buildIntentDetectionPrompt(context);
    const unifiedPrompt = await IntentPromptService.generateIntentPrompt(
      basePrompt,
      context.currentDocument?.type,
      context
    );

    // Define enhanced intent schema with document-type awareness
    const intentSchema = z.object({
      intent: z.enum([
        EmailIntent.DOC_FEEDBACK,
        EmailIntent.ACCEPT,
        EmailIntent.REJECT,
        EmailIntent.OFFTOPIC,
        EmailIntent.OTHER,
      ]),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("Confidence level from 0 to 1"),
      summary: z
        .string()
        .max(1000)
        .describe("Brief summary of the email content and intent"),
      requestedChanges: z
        .array(
          z.object({
            section: z
              .string()
              .optional()
              .describe("Specific document section affected"),
            change: z.string().describe("Description of the requested change"),
            priority: z
              .enum(["high", "medium", "low"])
              .optional()
              .describe("Priority level of the change"),
            feasibility: z
              .enum(["easy", "moderate", "complex"])
              .optional()
              .describe("Estimated complexity of implementing the change"),
          })
        )
        .optional()
        .describe(
          "Structured list of specific changes requested (only for DOC_FEEDBACK intent)"
        ),
      reasoning: z
        .string()
        .max(1500)
        .describe("Detailed explanation for the detected intent and analysis"),
      requiresAction: z
        .boolean()
        .describe("Whether this email requires system action"),
      suggestedAction: z
        .string()
        .optional()
        .describe("Suggested action to take if requiresAction is true"),
      documentTypeAnalysis: z
        .object({
          structuralImpact: z
            .string()
            .optional()
            .describe("How changes affect document structure"),
          sectionReferences: z
            .array(z.string())
            .optional()
            .describe("Document sections mentioned in feedback"),
          complianceCheck: z
            .boolean()
            .optional()
            .describe("Whether changes comply with document type requirements"),
          implementationNotes: z
            .string()
            .optional()
            .describe(
              "Notes on implementing changes within document framework"
            ),
        })
        .optional()
        .describe("Document-type specific analysis"),
      clientSentiment: z
        .enum(["positive", "neutral", "negative", "mixed"])
        .optional()
        .describe("Overall sentiment of the client's feedback"),
      urgency: z
        .enum(["low", "medium", "high", "urgent"])
        .optional()
        .describe("Urgency level based on client's language and tone"),
    });

    // Call LLM for structured intent detection with unified prompt
    const intentResult = await llmClient.generateStructured(
      intentSchema,
      unifiedPrompt,
      {
        ...systemContext,
        intentType: context.currentDocument?.type,
        hasTypeContext: !!context.currentDocument?.type,
      },
      "classification"
    );

    logger.debug(
      {
        emailId: context.email.id,
        intentResult,
      },
      "Intent detection result received"
    );

    logger.debug(
      {
        emailId: context.email.id,
        documentType: context.currentDocument?.type,
        intentResultKeys: Object.keys(intentResult.data || {}),
      },
      "Intent detection result received"
    );

    logger.info(
      {
        emailId: context.email.id,
        intent: intentResult.data.intent,
        confidence: intentResult.data.confidence,
        requiresAction: intentResult.data.requiresAction,
        tokenUsage: intentResult.tokenUsage?.totalTokens,
      },
      "Intent detection completed"
    );

    return {
      intent: intentResult.data.intent,
      confidence: intentResult.data.confidence,
      summary: intentResult.data.summary,
      requestedChanges: intentResult.data.requestedChanges || [],
      reasoning: intentResult.data.reasoning,
      requiresAction: intentResult.data.requiresAction,
      suggestedAction: intentResult.data.suggestedAction || null,
      documentTypeAnalysis: intentResult.data.documentTypeAnalysis || null,
      clientSentiment: intentResult.data.clientSentiment || null,
      urgency: intentResult.data.urgency || null,
      traceId: intentResult.traceId,
      tokenUsage: intentResult.tokenUsage,
      metadata: {
        intentType: context.currentDocument?.type,
        sentContentSource: context.currentDocument?.sentContentSource,
        analysisTimestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error(
      {
        emailId: context.email.id,
        error: error.message,
      },
      "Intent detection failed"
    );

    if (error instanceof LLMError) {
      throw error;
    }

    throw new LLMError("intent-detection", "detectEmailIntent", error, {
      emailId: context.email.id,
      projectId: context.project.id,
    });
  }
}

/**
 * Build prompt for intent detection
 * @param {Object} context - Email context
 * @returns {string} Formatted prompt
 */
function buildIntentDetectionPrompt(context) {
  const conversationHistoryText =
    context.conversationHistory.length > 0
      ? context.conversationHistory
          .map(
            (e, i) =>
              `${i + 1}. [${e.direction}] From: ${e.from}
   Subject: ${e.subject}
   Content: ${e.textBody.substring(0, 300)}${
                e.textBody.length > 300 ? "..." : ""
              }
   Intent: ${e.intent || "Unknown"}
`
          )
          .join("\n")
      : "No previous conversation history";

  const documentInfo = context.currentDocument
    ? `
Current Document Type: ${context.currentDocument.type}
Document Status: ${context.currentDocument.status}
Content Sent to Client: ${
        context.currentDocument.sentContent || "Not available"
      }
Latest Content (may differ from sent): ${
        context.currentDocument.content || "Not available"
      }
`
    : "No document currently being reviewed";

  return `You are analyzing a client email to detect their intent regarding a project document.

PROJECT INFORMATION:
- Client: ${context.project.client.name}
- Project: ${context.project.name}
- Current Phase: ${context.project.phase}

${documentInfo}

RECENT CONVERSATION HISTORY (most recent first):
${conversationHistoryText}

CURRENT EMAIL TO ANALYZE:
From: ${context.email.from}
Subject: ${context.email.subject}
Received: ${new Date(context.email.receivedAt).toLocaleString()}

Content:
${context.email.textBody}

INTENT CLASSIFICATION GUIDELINES:

1. **DOC_FEEDBACK**: Client is providing feedback, requesting changes, or asking for modifications to the document
   - Keywords: "change", "update", "modify", "revise", "can you", "please adjust", "I would like"
   - Includes specific requests or general dissatisfaction requiring document revision

2. **ACCEPT**: Client explicitly approves or accepts the document
   - Keywords: "approve", "accept", "looks good", "perfect", "go ahead", "proceed", "this works"
   - Must be clear and affirmative

3. **REJECT**: Client explicitly rejects the document or project
   - Keywords: "reject", "not interested", "cancel", "don't proceed", "stop"
   - Clear indication of wanting to stop the project

4. **OFFTOPIC**: Email is about something unrelated to the document or project
   - General conversation, questions about unrelated topics
   - No mention of the document or project deliverables

5. **OTHER**: Email doesn't clearly fit other categories but may need review
   - Ambiguous content
   - Questions that need human interpretation
   - Mixed intents

IMPORTANT CONSIDERATIONS:
- If the project phase is ${
    ProjectPhase.BRAND_ORIGIN
  } and there's a Brand Origin document, focus on feedback related to that
- If the project phase is ${
    ProjectPhase.QUOTE_DOCUMENT
  } and there's a Quote document, focus on feedback related to that
- Consider the conversation history to understand context
- Be conservative with ACCEPT - client must be clearly approving
- Set requiresAction to true for DOC_FEEDBACK, ACCEPT, or REJECT intents
- Set confidence based on clarity and explicitness of the intent

Analyze the email and provide your classification.`;
}

/**
 * Handle detected intent and trigger appropriate actions
 * @param {Object} context - Email context
 * @param {Object} intentResult - Detected intent result
 * @param {string} correlationId - Correlation ID
 * @returns {Promise<Object>} Action result
 */
async function handleDetectedIntent(context, intentResult, correlationId) {
  try {
    const { intent, requiresAction } = intentResult;
    const { project, currentDocument, email } = context;

    logger.info(
      {
        emailId: email.id,
        projectId: project.id,
        intent,
        requiresAction,
        correlationId,
      },
      "Handling detected intent"
    );

    // Update email record with detected intent and complete metadata
    await prisma.email.update({
      where: { id: email.id },
      data: {
        intent,
        intentConfidence: intentResult.confidence,
        intentMetadata: intentResult,
        llmTraceId: intentResult.traceId,
        processed: true,
      },
    });

    // Create audit log for intent detection with enhanced details
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "SYSTEM (Intent Detection)",
        action: AuditActions.EMAIL_INTENT_DETECTED,
        details: {
          emailId: email.id,
          intent,
          confidence: intentResult.confidence,
          summary: intentResult.summary,
          requiresAction,
          suggestedAction: intentResult.suggestedAction,
          requestedChangesCount: intentResult.requestedChanges?.length || 0,
          documentType: context.currentDocument?.type,
          clientSentiment: intentResult.clientSentiment,
          urgency: intentResult.urgency,
          hasDocumentTypeAnalysis: !!intentResult.documentTypeAnalysis,
          correlationId,
        },
        at: new Date(),
      },
    });

    // TODO: Any intent that the *intentResult.confidence* is less then 0.5 send to admin and PM and they manually confirm - dont take automatic action

    // If no action required, we're done
    if (!requiresAction) {
      logger.info(
        {
          emailId: email.id,
          intent,
          correlationId,
        },
        "No action required for this intent"
      );
      return {
        actionTaken: false,
        intent,
        message: "No action required",
      };
    }
    // Handle different intents
    switch (intent) {
      case EmailIntent.DOC_FEEDBACK:
        return await handleDocFeedbackIntent(
          context,
          intentResult,
          correlationId
        );

      case EmailIntent.ACCEPT:
        return await handleAcceptIntent(context, intentResult, correlationId);

      case EmailIntent.REJECT:
        return await handleRejectIntent(context, intentResult, correlationId);

      case EmailIntent.OFFTOPIC:
      case EmailIntent.OTHER:
        logger.info(
          {
            emailId: email.id,
            intent,
            correlationId,
          },
          "OFFTOPIC/OTHER intent detected - no automatic action"
        );
        return {
          actionTaken: false,
          intent,
          message:
            "Intent detected but no automatic action defined for this type",
          details: {
            requiresManualReview: true,
            intentType: intent,
            confidence: intentResult.confidence,
            summary: intentResult.summary,
          },
          peopleNotified: [],
        };

      default:
        logger.info(
          {
            emailId: email.id,
            intent,
            correlationId,
          },
          "Intent detected but no automatic action defined"
        );
        return {
          actionTaken: false,
          intent,
          message: "Intent detected but requires manual review",
        };
    }
  } catch (error) {
    logger.error(
      {
        emailId: context.email.id,
        intent: intentResult.intent,
        error: error.message,
        correlationId,
      },
      "Failed to handle detected intent"
    );
    throw error;
  }
}

/**
 * Handle DOC_FEEDBACK intent - client wants changes to document
 * @param {Object} context - Email context
 * @param {Object} intentResult - Intent result
 * @param {string} correlationId - Correlation ID
 * @returns {Promise<Object>} Action result
 */
async function handleDocFeedbackIntent(context, intentResult, correlationId) {
  try {
    const { project, currentDocument, email } = context;

    logger.info(
      {
        emailId: email.id,
        projectId: project.id,
        documentId: currentDocument?.id,
        requestedChangesCount: intentResult.requestedChanges?.length || 0,
        documentType: currentDocument?.type,
        clientSentiment: intentResult.clientSentiment,
        urgency: intentResult.urgency,
        correlationId,
      },
      "Handling DOC_FEEDBACK intent"
    );

    // Verify there's a document to provide feedback on
    if (!currentDocument) {
      logger.warn(
        {
          emailId: email.id,
          projectId: project.id,
          correlationId,
        },
        "DOC_FEEDBACK intent detected but no active document found"
      );
      return {
        actionTaken: false,
        intent: EmailIntent.DOC_FEEDBACK,
        message: "No active document to provide feedback on",
      };
    }

    // Update document status to CLIENT_FEEDBACK
    await prisma.document.update({
      where: { id: currentDocument.id },
      data: {
        status: DocumentStatus.CLIENT_FEEDBACK,
        updatedAt: new Date(),
      },
    });

    // Create audit log with enhanced feedback details
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: `CLIENT (${email.from}) - DETECTED INTENT`,
        action: AuditActions.DOCUMENT_FEEDBACK_RECEIVED,
        details: {
          emailId: email.id,
          documentId: currentDocument.id,
          documentType: currentDocument.type,
          summary: intentResult.summary,
          requestedChanges: intentResult.requestedChanges || [],
          clientSentiment: intentResult.clientSentiment,
          urgency: intentResult.urgency,
          documentTypeAnalysis: intentResult.documentTypeAnalysis,
          reasoning: intentResult.reasoning,
          correlationId,
        },
        at: new Date(),
      },
    });

    logger.info(
      {
        emailId: email.id,
        projectId: project.id,
        documentId: currentDocument.id,
        documentType: currentDocument.type,
        correlationId,
      },
      "Document status updated to CLIENT_FEEDBACK - Starting regeneration/update workflow"
    );

    // Step 3: Trigger automatic document regeneration/update based on feedback
    await triggerDocumentRegeneration(context, intentResult, correlationId);

    return {
      actionTaken: true,
      intent: EmailIntent.DOC_FEEDBACK,
      message: "Document regeneration triggered based on client feedback",
      documentId: currentDocument.id,
      documentStatus: DocumentStatus.CLIENT_FEEDBACK,
      regenerationTriggered: true,
      peopleNotified: [],
      details: {
        documentType: currentDocument.type,
        requestedChangesCount: intentResult.requestedChanges?.length || 0,
        clientSentiment: intentResult.clientSentiment,
        urgency: intentResult.urgency,
        regenerationQueued: true,
      },
    };
  } catch (error) {
    logger.error(
      {
        emailId: context.email.id,
        error: error.message,
        correlationId,
      },
      "Failed to handle DOC_FEEDBACK intent"
    );
    throw error;
  }
}

/**
 * Handle ACCEPT intent - client accepts the document
 * @param {Object} context - Email context
 * @param {Object} intentResult - Intent result
 * @param {string} correlationId - Correlation ID
 * @returns {Promise<Object>} Action result
 */
async function handleAcceptIntent(context, intentResult, correlationId) {
  try {
    const { project, currentDocument, email } = context;

    logger.info(
      {
        emailId: email?.id,
        projectId: project.id,
        documentId: currentDocument?.id,
        documentType: currentDocument?.type,
        correlationId,
        isManualAccept: !email,
      },
      "Handling ACCEPT intent"
    );

    // Verify there's a document to accept
    if (!currentDocument) {
      logger.warn(
        {
          emailId: email?.id,
          projectId: project.id,
          correlationId,
        },
        "ACCEPT intent detected but no active document found"
      );
      return {
        actionTaken: false,
        intent: EmailIntent.ACCEPT,
        message: "No active document to accept",
      };
    }

    // Update document status to ACCEPTED
    await prisma.document.update({
      where: { id: currentDocument.id },
      data: {
        status: DocumentStatus.ACCEPTED,
        updatedAt: new Date(),
      },
    });

    // Create audit log
    const actor = email
      ? `CLIENT (${email.from}) - DETECTED INTENT`
      : "ADMIN (Manual Accept)";
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor,
        action: "DOCUMENT_ACCEPTED",
        details: {
          emailId: email?.id || null,
          documentId: currentDocument.id,
          documentType: currentDocument.type,
          summary: intentResult?.summary || "Manual acceptance from Admin UI",
          correlationId,
          isManualAccept: !email,
        },
        at: new Date(),
      },
    });

    logger.info(
      {
        emailId: email?.id,
        projectId: project.id,
        documentId: currentDocument.id,
        documentType: currentDocument.type,
        correlationId,
        isManualAccept: !email,
      },
      "Document accepted - Next phase workflow should trigger"
    );

    if (currentDocument.type === DocumentType.BRAND_ORIGIN) {
      await handleBrandOriginAcceptance(project, correlationId);

      return {
        actionTaken: true,
        intent: EmailIntent.ACCEPT,
        message: "Brand origin accepted - quote generation queued",
        documentId: currentDocument.id,
        documentType: currentDocument.type,
        documentStatus: DocumentStatus.ACCEPTED,
        peopleNotified: [],
        details: {
          nextAction: "quote_generation_queued",
          projectPhaseTransition: ProjectPhase.QUOTE_DOCUMENT,
        },
      };
    }

    if (currentDocument.type === DocumentType.QUOTE) {
      const quoteAcceptanceResult = await handleQuoteAcceptance(
        project,
        currentDocument,
        email,
        intentResult,
        correlationId
      );

      return {
        actionTaken: true,
        intent: EmailIntent.ACCEPT,
        message: "Quote accepted - invoice created and project finalized",
        documentId: currentDocument.id,
        documentType: currentDocument.type,
        documentStatus: DocumentStatus.ACCEPTED,
        invoiceId: quoteAcceptanceResult.invoiceId,
        peopleNotified: quoteAcceptanceResult.peopleNotified || [],
        details: {
          selectedQuoteId: quoteAcceptanceResult.selectedQuoteId,
          invoiceId: quoteAcceptanceResult.invoiceId,
          projectFinalized: true,
          asanaProjectInitQueued: true,
        },
      };
    }

    return {
      actionTaken: true,
      intent: EmailIntent.ACCEPT,
      message: "Document accepted - workflow pending for this document type",
      documentId: currentDocument.id,
      documentType: currentDocument.type,
      documentStatus: DocumentStatus.ACCEPTED,
      peopleNotified: [],
      details: {
        documentType: currentDocument.type,
        status: DocumentStatus.ACCEPTED,
      },
    };
  } catch (error) {
    logger.error(
      {
        emailId: context.email?.id,
        projectId: context.project?.id,
        error: error.message,
        correlationId,
      },
      "Failed to handle ACCEPT intent"
    );
    throw error;
  }
}

/**
 * Handle brand origin acceptance - advance phase and trigger quote generation
 * @param {Object} project - Project data from context
 * @param {string} correlationId - Correlation ID
 * @param {Object} options - Optional settings
 * @param {boolean} options.skipPhaseTransition - If true, caller handles phase transition
 * @returns {Promise<void>}
 */
async function handleBrandOriginAcceptance(
  project,
  correlationId,
  options = {}
) {
  try {
    const dedupeKey = `project:${project.id}:quote:generate`;

    await QueueService.addQuoteGenerationJob({
      projectId: project.id,
      dedupeKey,
      correlationId,
    });

    // Only transition phase if not skipped (UI may handle phase transition differently)
    if (!options.skipPhaseTransition) {
      await transitionProjectPhaseIfNeeded(
        project.id,
        ProjectPhase.QUOTE_DOCUMENT,
        "Client accepted brand origin document",
        correlationId
      );
    }

    await AsanaPendingProjectsService.moveTaskToSection(
      project.id,
      AsanaPendingProjectsBoardSections.QUOTE_DOCUMENT_PHASE,
      { correlationId }
    );
  } catch (error) {
    logger.error(
      {
        projectId: project.id,
        correlationId,
        error: error.message,
      },
      "Failed to process brand origin acceptance workflow"
    );
    throw error;
  }
}

/**
 * Handle quote acceptance - submit quote, create invoice, finalize project
 * @param {Object} project - Project data from context
 * @param {Object} document - Document data from context
 * @param {Object} email - Email data from context
 * @param {Object} intentResult - Intent detection result
 * @param {string} correlationId - Correlation ID
 * @returns {Promise<void>}
 */
async function handleQuoteAcceptance(
  project,
  document,
  email,
  intentResult,
  correlationId
) {
  try {
    logger.info(
      {
        projectId: project.id,
        documentId: document.id,
        correlationId,
      },
      "Starting quote acceptance workflow"
    );

    // Get full document with selected quote ID
    const fullDocument = await prisma.document.findUnique({
      where: { id: document.id },
      include: {
        project: {
          include: {
            client: true,
          },
        },
      },
    });

    if (!fullDocument) {
      throw new ValidationError(`Document not found: ${document.id}`);
    }

    if (!fullDocument.selectedQuoteId) {
      throw new ValidationError(
        `Quote document ${document.id} has no selected quote ID`
      );
    }

    const selectedQuoteId = fullDocument.selectedQuoteId;
    let invoiceId = null;
    const peopleNotified = [];

    // Step 1: Verify quote is not cancelled before submitting
    logger.info(
      {
        projectId: project.id,
        selectedQuoteId,
        correlationId,
      },
      "Verifying quote status before submission"
    );

    const quoteDetails = await erpIntegration.getQuotation(selectedQuoteId);
    if (quoteDetails.quotation_canceled) {
      throw new ValidationError(
        `Cannot submit cancelled quotation: ${selectedQuoteId}. Latest cancelled ID: ${quoteDetails.latest_canceled_id}`
      );
    }

    // Step 2: Submit quote (docstatus: 0 → 1)
    logger.info(
      {
        projectId: project.id,
        selectedQuoteId,
        correlationId,
      },
      "Submitting quote to ERP"
    );

    await erpIntegration.submitQuotation(selectedQuoteId);

    logger.info(
      {
        projectId: project.id,
        selectedQuoteId,
        correlationId,
      },
      "Quote submitted successfully"
    );

    // Step 3: Create invoice from quote
    logger.info(
      {
        projectId: project.id,
        selectedQuoteId,
        correlationId,
      },
      "Creating invoice from quote"
    );

    invoiceId = await QuoteService.createInvoiceFromQuote(
      selectedQuoteId,
      fullDocument.project
    );

    logger.info(
      {
        projectId: project.id,
        selectedQuoteId,
        invoiceId,
        correlationId,
      },
      "Invoice created successfully"
    );

    // Step 4: Update document with invoice ID in metadataInfo
    const currentMetadataInfo = fullDocument.metadataInfo || {};
    await prisma.document.update({
      where: { id: document.id },
      data: {
        metadataInfo: {
          ...currentMetadataInfo,
          invoiceId: invoiceId,
        },
        updatedAt: new Date(),
      },
    });

    // Step 5: Create audit logs
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: email
          ? `CLIENT (${email.from}) - DETECTED INTENT`
          : "ADMIN (Manual Accept)",
        action: AuditActions.QUOTE_ACCEPTED,
        details: {
          emailId: email?.id || null,
          documentId: document.id,
          selectedQuoteId,
          invoiceId,
          summary: intentResult?.summary || "Manual acceptance from Admin UI",
          correlationId,
          isManualAccept: !email,
        },
        at: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: SystemActors.QUOTE_GENERATOR,
        action: AuditActions.INVOICE_CREATED,
        details: {
          documentId: document.id,
          selectedQuoteId,
          invoiceId,
          correlationId,
        },
        at: new Date(),
      },
    });

    // Step 6: Send confirmation email if detected via email intent (not manual)
    // Note: Manual accepts (from Admin UI) should not send confirmation email
    // Check if email exists and has an id (from email intent detection)
    const isEmailIntent = email && typeof email === "object" && email.id;
    if (isEmailIntent) {
      const notifiedPeople = await sendQuoteAcceptanceConfirmationEmail(
        fullDocument.project,
        fullDocument,
        invoiceId,
        correlationId
      );
      if (notifiedPeople && Array.isArray(notifiedPeople)) {
        peopleNotified.push(...notifiedPeople);
      }
    } else {
      logger.info(
        {
          projectId: project.id,
          documentId: document.id,
          correlationId,
        },
        "Skipping confirmation email - manual accept from Admin UI"
      );
    }

    // Step 7: Finalize project (move to ASANA_INIT phase, enqueue Asana project init)
    await finalizeProject(project.id, correlationId);

    logger.info(
      {
        projectId: project.id,
        documentId: document.id,
        selectedQuoteId,
        invoiceId,
        correlationId,
      },
      "Quote acceptance workflow completed successfully"
    );

    // Return result with invoiceId and peopleNotified for admin notification
    return {
      invoiceId,
      selectedQuoteId,
      peopleNotified,
    };
  } catch (error) {
    logger.error(
      {
        projectId: project.id,
        documentId: document.id,
        error: error.message,
        stack: error.stack,
        correlationId,
      },
      "Failed to process quote acceptance workflow"
    );
    throw error;
  }
}

async function transitionProjectPhaseIfNeeded(
  projectId,
  targetPhase,
  reason,
  correlationId
) {
  try {
    await withTransaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { phase: true },
      });

      if (!project || project.phase === targetPhase) {
        return;
      }
      if (!isValidProjectPhaseTransition(project.phase, targetPhase)) {
        throw new ValidationError(
          `Invalid phase transition from ${project.phase} to ${targetPhase}`
        );
      }

      await tx.project.update({
        where: { id: projectId },
        data: {
          phase: targetPhase,
          updatedAt: new Date(),
        },
      });

      await tx.projectPhaseLog.create({
        data: {
          projectId,
          fromPhase: project.phase,
          toPhase: targetPhase,
          reason,
          actor: SystemActors.LEVITATE_AI_AGENT_SYSTEM,
          at: new Date(),
        },
      });
    });
  } catch (error) {
    logger.error(
      {
        projectId,
        targetPhase,
        correlationId,
        error: error.message,
        stack: error.stack,
      },
      "Failed to update project phase during acceptance workflow"
    );
    // Re-throw error to ensure phase transition failures are visible
    throw error;
  }
}

/**
 * Handle REJECT intent - client rejects the document or project
 * @param {Object} context - Email context
 * @param {Object} intentResult - Intent result
 * @param {string} correlationId - Correlation ID
 * @returns {Promise<Object>} Action result
 */
async function handleRejectIntent(context, intentResult, correlationId) {
  try {
    const { project, currentDocument, email } = context;

    logger.info(
      {
        emailId: email.id,
        projectId: project.id,
        documentId: currentDocument?.id,
        correlationId,
      },
      "Handling REJECT intent"
    );

    // Determine if this is document-level or project-level rejection
    // If there's a current document, it's likely document-level rejection
    // Otherwise, it's project-level rejection
    const isDocumentLevel = !!currentDocument;

    // Note: Document status update will be handled by the confirm-rejection API
    // when PM/Admin clicks the "Confirm Rejection" button

    // Create audit log for rejection detection
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: `CLIENT (${email.from}) - DETECTED INTENT`,
        action: isDocumentLevel
          ? AuditActions.DOCUMENT_REJECTED
          : AuditActions.PROJECT_REJECTED,
        details: {
          emailId: email.id,
          documentId: currentDocument?.id,
          documentType: currentDocument?.type,
          summary: intentResult.summary,
          reasoning: intentResult.reasoning,
          isDocumentLevel,
          confidence: intentResult.confidence,
          clientSentiment: intentResult.clientSentiment,
          urgency: intentResult.urgency,
          correlationId,
        },
        at: new Date(),
      },
    });

    // Send notification emails to PM and Admin with action buttons
    const peopleNotified = await sendRejectionNotificationEmails(
      context,
      intentResult,
      correlationId,
      isDocumentLevel
    );

    logger.info(
      {
        emailId: email.id,
        projectId: project.id,
        documentId: currentDocument?.id,
        isDocumentLevel,
        correlationId,
      },
      "Rejection detected - Notification emails sent to PM and Admin"
    );

    return {
      actionTaken: true,
      intent: EmailIntent.REJECT,
      message: "Rejection detected - Notification emails sent to PM and Admin",
      documentId: currentDocument?.id,
      documentStatus: currentDocument ? currentDocument.status : null, // Return current status, not REJECTED
      isDocumentLevel,
      peopleNotified: peopleNotified || [],
      details: {
        isDocumentLevel,
        confidence: intentResult.confidence,
        clientSentiment: intentResult.clientSentiment,
        urgency: intentResult.urgency,
        requestedChangesCount: intentResult.requestedChanges?.length || 0,
      },
    };
  } catch (error) {
    logger.error(
      {
        emailId: context.email.id,
        error: error.message,
        correlationId,
      },
      "Failed to handle REJECT intent"
    );
    throw error;
  }
}

/**
 * Send rejection notification emails to PM and Admin
 * @param {Object} context - Email context
 * @param {Object} intentResult - Intent detection result
 * @param {string} correlationId - Correlation ID for tracking
 * @param {boolean} isDocumentLevel - Whether this is document-level or project-level rejection
 * @returns {Promise<void>}
 */
async function sendRejectionNotificationEmails(
  context,
  intentResult,
  correlationId,
  isDocumentLevel
) {
  try {
    const { project, currentDocument, email } = context;

    // Get PM and Admin users
    const pmUser = await AsanaPendingProjectsService.getPMUser(project.id);

    const recipients = [];
    const peopleNotified = [];
    if (pmUser && pmUser.email) {
      recipients.push({
        email: pmUser.email,
        name: pmUser.name,
        role: "PM",
        userId: pmUser.id,
      });
    }

    if (appConfig.server.adminEmail) {
      // Find admin user for tokens
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
          userId: adminUser.id,
        });
      } else {
        // Fallback: add admin email even if not in team members
        recipients.push({
          email: appConfig.server.adminEmail,
          name: "Admin",
          role: "Admin",
          userId: null, // Will skip token generation for this recipient
        });
      }
    }

    if (recipients.length === 0) {
      logger.warn(
        {
          projectId: project.id,
          correlationId,
        },
        "No recipients found for rejection notification"
      );
      return;
    }

    // Generate action tokens for each recipient
    for (const recipient of recipients) {
      try {
        // Skip token generation if userId is not available
        let confirmRejectionToken = null;
        if (recipient.userId) {
          const actionToken = await ActionService.createActionToken(
            {
              action: ActionType.CONFIRM_REJECTION,
              documentId: currentDocument?.id || 0, // Use 0 if no document
              projectId: project.id,
              userId: recipient.userId,
              userEmail: recipient.email,
              userName: recipient.name,
              isDocumentLevel,
              emailId: email.id,
            },
            "72h" // Longer expiration for rejection confirmation
          );
          confirmRejectionToken = actionToken.token;
        }

        const actionTokens = {
          confirmRejectionToken,
        };

        // Generate email template
        const emailTemplate =
          EmailTemplateService.generateDetectedRejectionNotificationTemplate(
            project,
            currentDocument,
            email,
            intentResult,
            actionTokens,
            isDocumentLevel
          );

        // Send email
        await brevoIntegration.sendTransactionalEmail({
          to: [recipient.email],
          subject: emailTemplate.subject,
          htmlContent: emailTemplate.htmlContent,
        });

        peopleNotified.push({
          email: recipient.email,
          name: recipient.name,
          role: recipient.role,
        });

        logger.info(
          {
            recipient: recipient.email,
            role: recipient.role,
            projectId: project.id,
            correlationId,
          },
          "Rejection notification email sent successfully"
        );
      } catch (emailError) {
        logger.error(
          {
            recipient: recipient.email,
            role: recipient.role,
            emailError: emailError.message,
            projectId: project.id,
            correlationId,
          },
          "Failed to send rejection notification email"
        );
        // Continue with other recipients even if one fails
      }
    }

    // Create audit log for notification
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "SYSTEM (Intent Detection)",
        action: "REJECTION_NOTIFICATION_SENT",
        details: {
          emailId: email.id,
          documentId: currentDocument?.id,
          isDocumentLevel,
          recipientsNotified: recipients.map((r) => r.email),
          correlationId,
        },
        at: new Date(),
      },
    });

    return peopleNotified;
  } catch (error) {
    logger.error(
      {
        projectId: context.project.id,
        error: error.message,
        correlationId,
      },
      "Failed to send rejection notification emails"
    );
    // Don't throw - this shouldn't fail the main intent handling
    // The document status has already been updated and audit log created
    return [];
  }
}

/**
 * Send admin notification with intent processing results
 * @param {Object} context - Email context
 * @param {Object} intentResult - Intent detection result
 * @param {Object} actionResult - Action result from intent handling
 * @param {string} correlationId - Correlation ID
 * @returns {Promise<void>}
 */
async function sendAdminIntentProcessingNotification(
  context,
  intentResult,
  actionResult,
  correlationId
) {
  try {
    const adminEmail = appConfig.server.adminEmail;

    if (!adminEmail) {
      logger.warn(
        {
          emailId: context.email.id,
          projectId: context.project.id,
          correlationId,
        },
        "No admin email configured - skipping intent processing notification"
      );
      return;
    }

    // Collect people notified from action result
    const peopleNotified = [];
    if (actionResult?.peopleNotified) {
      peopleNotified.push(...actionResult.peopleNotified);
    }

    // Generate email template
    const emailTemplate =
      EmailTemplateService.generateIntentProcessingResultsTemplate(
        context.project,
        context.email,
        intentResult,
        actionResult,
        peopleNotified
      );

    // Send email to admin
    await brevoIntegration.sendTransactionalEmail({
      to: [adminEmail],
      subject: emailTemplate.subject,
      htmlContent: emailTemplate.htmlContent,
    });

    logger.info(
      {
        emailId: context.email.id,
        projectId: context.project.id,
        intent: intentResult.intent,
        adminEmail,
        correlationId,
      },
      "Admin intent processing notification sent successfully"
    );
  } catch (error) {
    logger.error(
      {
        emailId: context.email.id,
        projectId: context.project.id,
        error: error.message,
        correlationId,
      },
      "Failed to send admin intent processing notification"
    );
    // Don't throw - this is not critical for the main flow
  }
}

/**
 * Email Intent Detection Processor
 * Main worker function for processing email intent detection jobs
 */
const emailIntentProcessor = async (job) => {
  const startTime = Date.now();
  const { emailId, projectId, correlationId } = job.data;

  logger.info(
    {
      jobId: job.id,
      emailId,
      projectId,
      correlationId,
    },
    "Starting email intent detection"
  );

  try {
    // Step 1: Assemble context
    const context = await assembleIntentContext(emailId);

    // Step 2: Detect intent using LLM
    const intentResult = await detectEmailIntent(context);

    // Step 3: Handle detected intent
    const actionResult = await handleDetectedIntent(
      context,
      intentResult,
      correlationId
    );

    // Step 4: Send admin notification with full intent processing results
    await sendAdminIntentProcessingNotification(
      context,
      intentResult,
      actionResult,
      correlationId
    );

    const duration = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        emailId,
        projectId,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        actionTaken: actionResult.actionTaken,
        duration,
        correlationId,
      },
      "Email intent detection completed successfully"
    );

    return {
      success: true,
      emailId,
      projectId,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      summary: intentResult.summary,
      actionTaken: actionResult.actionTaken,
      actionResult: actionResult.message,
      processingTime: duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        jobId: job.id,
        emailId,
        projectId,
        error: error.message,
        errorType: error.constructor.name,
        duration,
        correlationId,
        stack: error.stack,
      },
      "Email intent detection failed"
    );

    // Mark email as processed with error
    try {
      await prisma.email.update({
        where: { id: emailId },
        data: {
          processed: true,
          intent: EmailIntent.OTHER,
          intentConfidence: 0,
        },
      });
    } catch (updateError) {
      logger.error(
        {
          emailId,
          updateError: updateError.message,
        },
        "Failed to mark email as processed after error"
      );
    }

    throw error;
  }
};

/**
 * Trigger document regeneration based on client feedback
 * @param {Object} context - Email context
 * @param {Object} intentResult - Intent detection result
 * @param {string} correlationId - Correlation ID for tracking
 * @returns {Promise<void>}
 */
async function triggerDocumentRegeneration(
  context,
  intentResult,
  correlationId
) {
  const { project, currentDocument, email } = context;

  try {
    logger.info(
      {
        emailId: email.id,
        projectId: project.id,
        documentId: currentDocument.id,
        documentType: currentDocument.type,
        correlationId,
      },
      "Starting document regeneration workflow"
    );

    // Use retry logic for the regeneration process
    await retry(
      async () => {
        // Prepare feedback context for regeneration
        const feedbackContext = {
          isRegeneration: true,
          emailId: email.id,
          originalDocumentId: currentDocument.id,
          intentResult,
          originalDocumentContent:
            currentDocument.sentContent || currentDocument.content,
          emailInfo: {
            from: email.from,
            subject: email.subject,
            textBody: email.textBody,
            receivedAt: email.receivedAt,
          },
        };

        // Enqueue document regeneration/update job based on document type
        switch (currentDocument.type) {
          case DocumentType.BRAND_ORIGIN:
            const jobData = {
              projectId: project.id,
              correlationId,
              feedbackContext,
              timestamp: new Date().toISOString(),
            };

            const job = await QueueService.addBrandOriginGenerationJob(
              jobData,
              2
            ); // High priority for regeneration

            logger.info(
              {
                jobId: job.id,
                emailId: email.id,
                projectId: project.id,
                documentId: currentDocument.id,
                correlationId,
              },
              "Brand origin regeneration job enqueued successfully"
            );
            break;

          case DocumentType.QUOTE:
            // For QUOTE documents, use quote update job (not regeneration)
            const quoteUpdateJobData = {
              projectId: project.id,
              documentId: currentDocument.id,
              correlationId,
              feedbackContext,
              intentResult,
              timestamp: new Date().toISOString(),
            };

            const quoteUpdateJob = await QueueService.addQuoteUpdateJob(
              quoteUpdateJobData,
              2 // High priority for client feedback
            );

            logger.info(
              {
                jobId: quoteUpdateJob.id,
                emailId: email.id,
                projectId: project.id,
                documentId: currentDocument.id,
                correlationId,
              },
              "Quote update job enqueued successfully"
            );
            break;

          default:
            logger.warn(
              {
                emailId: email.id,
                documentType: currentDocument.type,
                correlationId,
              },
              "Document type not supported for automatic regeneration/update"
            );
            // For unsupported document types, just log and continue
            // Future: Add support for other document types
            break;
        }

        // Create audit log for regeneration trigger
        await prisma.auditLog.create({
          data: {
            projectId: project.id,
            actor: "SYSTEM (Intent Detection)",
            action: "DOCUMENT_REGENERATION_TRIGGERED",
            details: {
              emailId: email.id,
              documentId: currentDocument.id,
              documentType: currentDocument.type,
              intent: intentResult.intent,
              confidence: intentResult.confidence,
              summary: intentResult.summary,
              requestedChangesCount: intentResult.requestedChanges?.length || 0,
              correlationId,
            },
            at: new Date(),
          },
        });
      },
      3, // maxAttempts
      2000, // delayMs - 2 seconds
      2 // backoffMultiplier
    );

    logger.info(
      {
        emailId: email.id,
        projectId: project.id,
        documentId: currentDocument.id,
        correlationId,
      },
      "Document regeneration workflow triggered successfully"
    );
  } catch (error) {
    logger.error(
      {
        emailId: email.id,
        projectId: project.id,
        documentId: currentDocument.id,
        error: error.message,
        stack: error.stack,
        correlationId,
      },
      "Failed to trigger document regeneration after 3 retry attempts"
    );

    // Notify admin and PM about the failure
    await notifyRegenerationFailure(
      context,
      intentResult,
      error,
      correlationId
    );

    // Don't throw error - this shouldn't fail the main intent handling
    // The document status has already been updated, so PM can handle manually
  }
}

/**
 * Notify admin and PM about document regeneration failure
 * @param {Object} context - Email context
 * @param {Object} intentResult - Intent detection result
 * @param {Error} error - The error that occurred
 * @param {string} correlationId - Correlation ID for tracking
 * @returns {Promise<void>}
 */
async function notifyRegenerationFailure(
  context,
  intentResult,
  error,
  correlationId
) {
  try {
    const { project, currentDocument, email } = context;

    // Get PM user for notification
    const pmUser = await AsanaPendingProjectsService.getPMUser(project.id);

    // Prepare notification recipients
    const recipients = [];

    if (pmUser && pmUser.email) {
      recipients.push({
        email: pmUser.email,
        name: pmUser.name,
        role: "PM",
      });
    }

    if (appConfig.server.adminEmail) {
      recipients.push({
        email: appConfig.server.adminEmail,
        name: "Admin",
        role: "Admin",
      });
    }

    if (recipients.length === 0) {
      logger.warn(
        {
          projectId: project.id,
          correlationId,
        },
        "No recipients found for regeneration failure notification"
      );
      return;
    }

    // Generate failure notification email using EmailTemplateService
    const emailTemplate =
      EmailTemplateService.generateDocumentRegenerationFailureTemplate(
        project,
        currentDocument,
        email,
        intentResult,
        error,
        correlationId
      );

    // Send notification to all recipients
    for (const recipient of recipients) {
      try {
        await brevoIntegration.sendTransactionalEmail({
          to: [recipient.email],
          subject: emailTemplate.subject,
          htmlContent: emailTemplate.htmlContent,
        });

        logger.info(
          {
            recipient: recipient.email,
            role: recipient.role,
            projectId: project.id,
            correlationId,
          },
          "Regeneration failure notification sent successfully"
        );
      } catch (emailError) {
        logger.error(
          {
            recipient: recipient.email,
            role: recipient.role,
            emailError: emailError.message,
            projectId: project.id,
            correlationId,
          },
          "Failed to send regeneration failure notification"
        );
      }
    }

    // Create audit log for the failure notification
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "SYSTEM (Error Handler)",
        action: "REGENERATION_FAILURE_NOTIFIED",
        details: {
          emailId: email.id,
          documentId: currentDocument.id,
          error: error.message,
          recipientsNotified: recipients.map((r) => r.email),
          correlationId,
        },
        at: new Date(),
      },
    });
  } catch (notificationError) {
    logger.error(
      {
        projectId: context.project.id,
        notificationError: notificationError.message,
        correlationId,
      },
      "Failed to send regeneration failure notifications"
    );
  }
}

/**
 * Retrieve complete intent metadata for document regeneration
 * @param {number} emailId - Email ID to get intent metadata for
 * @returns {Promise<Object|null>} Complete intent metadata or null if not found
 */
async function getIntentMetadataForRegeneration(emailId) {
  try {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        intent: true,
        intentConfidence: true,
        intentMetadata: true,
        fromAddr: true,
        subject: true,
        textBody: true,
        receivedAt: true,
        thread: {
          select: {
            project: {
              select: {
                id: true,
                name: true,
                client: {
                  select: {
                    name: true,
                    primaryEmail: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!email || !email.intentMetadata) {
      logger.warn(
        {
          emailId,
          hasEmail: !!email,
          hasIntentMetadata: !!email?.intentMetadata,
        },
        "No intent metadata found for email"
      );
      return null;
    }

    logger.info(
      {
        emailId,
        intent: email.intent,
        confidence: email.intentConfidence,
        hasRequestedChanges: !!email.intentMetadata?.requestedChanges?.length,
        documentType: email.intentMetadata?.metadata?.documentType,
      },
      "Retrieved intent metadata for document regeneration"
    );

    return {
      emailId: email.id,
      intent: email.intent,
      confidence: email.intentConfidence,
      metadata: email.intentMetadata,
      clientInfo: {
        email: email.fromAddr,
        name: email.thread?.project?.client?.name,
      },
      projectInfo: {
        id: email.thread?.project?.id,
        name: email.thread?.project?.name,
      },
      emailInfo: {
        subject: email.subject,
        textBody: email.textBody,
        receivedAt: email.receivedAt,
      },
    };
  } catch (error) {
    logger.error(
      {
        emailId,
        error: error.message,
      },
      "Failed to retrieve intent metadata for regeneration"
    );
    throw error;
  }
}

/**
 * Finalize project - move to Finalized phase and enqueue Asana project initialization
 * @param {number} projectId - Project ID
 * @param {string} correlationId - Correlation ID
 * @param {Object} options - Optional settings
 * @param {boolean} options.skipPhaseTransition - If true, caller handles phase transition
 * @returns {Promise<void>}
 */
async function finalizeProject(projectId, correlationId, options = {}) {
  try {
    logger.info(
      {
        projectId,
        correlationId,
      },
      "Starting project finalization"
    );

    // Step 1: Move Asana task to "Finalized" section
    await AsanaPendingProjectsService.moveTaskToSection(
      projectId,
      AsanaPendingProjectsBoardSections.FINALIZED,
      { correlationId }
    );

    // Step 2: Update project phase to ASANA_INIT (not FINALIZED yet - that happens after workplan)
    // Only transition phase if not skipped (UI may handle phase transition differently)
    if (!options.skipPhaseTransition) {
      await transitionProjectPhaseIfNeeded(
        projectId,
        ProjectPhase.ASANA_INIT,
        "Quote accepted by client - starting Asana project initialization",
        correlationId
      );
    }

    // Step 3: Enqueue Asana project initialization job
    const dedupeKey = `project:${projectId}:asana_init`;
    await QueueService.addAsanaProjectInitJob({
      projectId,
      dedupeKey,
      correlationId,
    });

    logger.info(
      {
        projectId,
        dedupeKey,
        correlationId,
      },
      "Project finalization completed - Asana project init queued"
    );
  } catch (error) {
    logger.error(
      {
        projectId,
        error: error.message,
        stack: error.stack,
        correlationId,
      },
      "Failed to finalize project"
    );
    throw error;
  }
}

/**
 * Send quote acceptance confirmation email to Admin & Finance Manager
 * Only sent if detected via email intent (not manual accept)
 * @param {Object} project - Project data
 * @param {Object} document - Document data
 * @param {string} invoiceId - Invoice ID
 * @param {string} correlationId - Correlation ID
 * @returns {Promise<void>}
 */
async function sendQuoteAcceptanceConfirmationEmail(
  project,
  document,
  invoiceId,
  correlationId
) {
  try {
    logger.info(
      {
        projectId: project.id,
        documentId: document.id,
        invoiceId,
        correlationId,
      },
      "Sending quote acceptance confirmation email"
    );

    // Get Admin and Finance Manager users
    const recipients = [];
    const peopleNotified = [];

    // Get Finance Manager - query all active team members and filter by role
    const allActiveTeamMembers = await prisma.teamMember.findMany({
      where: {
        isActive: true,
      },
    });

    const financeManager = allActiveTeamMembers.find((member) => {
      if (!member.roles || !Array.isArray(member.roles)) return false;
      return member.roles.some(
        (r) =>
          r.role === "FINANCE_MANAGER" ||
          r.role === "Finance Manager" ||
          r.role === "Finance"
      );
    });

    if (financeManager && financeManager.email) {
      recipients.push({
        email: financeManager.email,
        name: financeManager.name,
        role: "Finance Manager",
      });
    }

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

    if (recipients.length === 0) {
      logger.warn(
        {
          projectId: project.id,
          correlationId,
        },
        "No recipients found for quote acceptance confirmation email"
      );
      return;
    }

    // Generate email template
    const emailTemplate =
      EmailTemplateService.generateQuoteAcceptanceConfirmationTemplate(
        project,
        document,
        invoiceId
      );

    // Send email to all recipients
    for (const recipient of recipients) {
      try {
        await brevoIntegration.sendTransactionalEmail({
          to: [recipient.email],
          subject: emailTemplate.subject,
          htmlContent: emailTemplate.htmlContent,
        });

        logger.info(
          {
            recipient: recipient.email,
            role: recipient.role,
            projectId: project.id,
            invoiceId,
            correlationId,
          },
          "Quote acceptance confirmation email sent successfully"
        );
      } catch (emailError) {
        logger.error(
          {
            recipient: recipient.email,
            role: recipient.role,
            emailError: emailError.message,
            projectId: project.id,
            correlationId,
          },
          "Failed to send quote acceptance confirmation email"
        );
        // Continue with other recipients even if one fails
      }
    }

    // Create audit log for notification
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: "SYSTEM (Quote Acceptance)",
        action: "QUOTE_ACCEPTANCE_CONFIRMATION_SENT",
        details: {
          documentId: document.id,
          invoiceId,
          recipientsNotified: recipients.map((r) => r.email),
          correlationId,
        },
        at: new Date(),
      },
    });
  } catch (error) {
    logger.error(
      {
        projectId: project.id,
        documentId: document.id,
        error: error.message,
        correlationId,
      },
      "Failed to send quote acceptance confirmation email"
    );
    // Don't throw - this shouldn't fail the main workflow
  }
}

/**
 * Assemble context for feedback-based intent detection (UI regeneration)
 * Similar to assembleIntentContext but for UI feedback instead of email
 * @param {number} documentId - Document ID to analyze
 * @param {string} feedbackText - Feedback text from UI
 * @returns {Promise<Object>} Complete context for LLM
 */
async function assembleFeedbackIntentContext(documentId, feedbackText) {
  try {
    // Get document with all related data
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        project: {
          include: {
            client: true,
            documents: {
              where: {
                status: {
                  in: [
                    DocumentStatus.SENT_TO_CLIENT,
                    DocumentStatus.CLIENT_FEEDBACK,
                    DocumentStatus.PM_REVIEW,
                    DocumentStatus.FINANCE_MANAGER_REVIEW,
                  ],
                },
              },
              orderBy: { updatedAt: "desc" },
              take: 10,
              include: {
                currentRevision: true,
                lastSentRevision: true,
              },
            },
            questionnaireResponses: {
              orderBy: { submittedAt: "desc" },
              take: 1,
            },
            thread: {
              include: {
                emails: {
                  orderBy: { receivedAt: "desc" },
                  take: 10, // Last 10 emails for context
                },
              },
            },
          },
        },
        currentRevision: true,
        lastSentRevision: true,
      },
    });

    if (!document) {
      throw new ValidationError(`Document not found: ${documentId}`);
    }

    if (!document.project) {
      throw new ValidationError(
        `Document ${documentId} has no associated project`
      );
    }

    const project = document.project;

    // Get conversation history from thread emails
    const conversationHistory =
      project.thread?.emails?.map((e) => ({
        direction: e.direction,
        from: e.fromAddr,
        subject: e.subject,
        textBody: e.textBody,
        receivedAt: e.receivedAt,
        intent: e.intent,
      })) || [];

    // Get the content that was actually sent to the client
    let sentDocumentContent = null;
    let sentContentSource = "none";

    if (document.lastSentRevision) {
      const lastSentRevision = document.lastSentRevision;
      const snapshotMd = lastSentRevision.snapshotMd;
      const hasPdfFileId = snapshotMd?.pdfFileId;
      const sourceRevisionId = snapshotMd?.sourceRevisionId;

      if (hasPdfFileId && sourceRevisionId) {
        try {
          const sourceRevision = await prisma.documentRevision.findUnique({
            where: { id: sourceRevisionId },
          });

          if (sourceRevision?.snapshotText) {
            sentDocumentContent = sourceRevision.snapshotText;
            sentContentSource = "source_revision";
          } else if (document.driveFileId) {
            sentDocumentContent = await googleIntegration.exportDocumentAsText(
              document.driveFileId
            );
            sentContentSource = "google_drive_fallback";
          } else {
            sentDocumentContent = lastSentRevision.snapshotText;
            sentContentSource = "last_sent_snapshot_fallback";
          }
        } catch (error) {
          logger.warn(
            {
              documentId,
              error: error.message,
            },
            "Failed to get sent content, using fallback"
          );
          if (document.driveFileId) {
            try {
              sentDocumentContent =
                await googleIntegration.exportDocumentAsText(
                  document.driveFileId
                );
              sentContentSource = "google_drive_error_fallback";
            } catch (driveError) {
              sentDocumentContent = lastSentRevision.snapshotText;
              sentContentSource = "last_sent_snapshot_fallback";
            }
          } else {
            sentDocumentContent = lastSentRevision.snapshotText;
            sentContentSource = "last_sent_snapshot_no_drive";
          }
        }
      } else {
        sentDocumentContent = lastSentRevision.snapshotText;
        sentContentSource = "google_docs_revision";
      }
    } else if (document.currentRevision) {
      sentDocumentContent = document.currentRevision.snapshotText;
      sentContentSource = "current_revision_fallback";
    }

    logger.info(
      {
        documentId,
        projectId: project.id,
        projectPhase: project.phase,
        documentType: document.type,
        conversationHistoryLength: conversationHistory.length,
        sentContentSource,
        sentContentLength: sentDocumentContent?.length || 0,
      },
      "Feedback intent context assembled successfully"
    );

    // Create a synthetic email object for compatibility with detectEmailIntent
    return {
      email: {
        id: null, // No email ID for UI feedback
        from: `ADMIN (${project.client.name})`,
        subject: `Feedback for ${document.type} document`,
        textBody: feedbackText,
        htmlBody: null,
        receivedAt: new Date(),
      },
      project: {
        id: project.id,
        name: project.name,
        phase: project.phase,
        client: {
          id: project.client.id,
          name: project.client.name,
          email: project.client.primaryEmail,
        },
      },
      currentDocument: {
        id: document.id,
        type: document.type,
        status: document.status,
        content: document.currentRevision?.snapshotText || null,
        sentContent: sentDocumentContent,
        sentContentSource,
        lastSentRevisionId: document.lastSentRevisionId,
      },
      conversationHistory,
      questionnaireContext: project.questionnaireResponses[0]
        ? {
            responses: project.questionnaireResponses[0].responses,
            submittedAt: project.questionnaireResponses[0].submittedAt,
          }
        : null,
    };
  } catch (error) {
    logger.error(
      {
        documentId,
        error: error.message,
      },
      "Failed to assemble feedback intent context"
    );
    throw error;
  }
}

/**
 * Detect intent from feedback text (for UI regeneration)
 * Reuses the same detectEmailIntent logic but with feedback context
 * @param {number} documentId - Document ID
 * @param {string} feedbackText - Feedback text from UI
 * @returns {Promise<Object>} Detected intent with confidence and details
 */
async function detectFeedbackIntent(documentId, feedbackText) {
  try {
    // Assemble context from document/project/feedback
    const context = await assembleFeedbackIntentContext(
      documentId,
      feedbackText
    );

    // Use the same intent detection logic
    const intentResult = await detectEmailIntent(context);

    logger.info(
      {
        documentId,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        requestedChangesCount: intentResult.requestedChanges?.length || 0,
      },
      "Feedback intent detection completed"
    );

    return intentResult;
  } catch (error) {
    logger.error(
      {
        documentId,
        error: error.message,
      },
      "Failed to detect feedback intent"
    );
    throw error;
  }
}

/**
 * Feedback Intent Detection Processor
 * Processes feedback intent detection jobs from UI regeneration
 */
const feedbackIntentProcessor = async (job) => {
  const startTime = Date.now();
  const { documentId, feedbackText, correlationId } = job.data;

  logger.info(
    {
      jobId: job.id,
      documentId,
      correlationId,
    },
    "Starting feedback intent detection"
  );

  try {
    const intentResult = await detectFeedbackIntent(documentId, feedbackText);

    const duration = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        documentId,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        duration,
        correlationId,
      },
      "Feedback intent detection completed successfully"
    );

    return {
      success: true,
      documentId,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      summary: intentResult.summary,
      requestedChanges: intentResult.requestedChanges || [],
      reasoning: intentResult.reasoning,
      clientSentiment: intentResult.clientSentiment,
      urgency: intentResult.urgency,
      documentTypeAnalysis: intentResult.documentTypeAnalysis,
      processingTime: duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        jobId: job.id,
        documentId,
        error: error.message,
        errorType: error.constructor.name,
        duration,
        correlationId,
        stack: error.stack,
      },
      "Feedback intent detection failed"
    );

    throw error;
  }
};

module.exports = {
  emailIntentProcessor,
  feedbackIntentProcessor,
  assembleIntentContext,
  assembleFeedbackIntentContext,
  detectEmailIntent,
  detectFeedbackIntent,
  handleDetectedIntent,
  getIntentMetadataForRegeneration,
  // Export reusable phase transition functions for manual UI operations
  handleBrandOriginAcceptance,
  handleQuoteAcceptance,
  transitionProjectPhaseIfNeeded,
  finalizeProject,
};
