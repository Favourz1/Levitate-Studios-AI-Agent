const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { llmClient } = require("@/llm/client");
const { z } = require("zod");
const { ValidationError, LLMError } = require("@/utils/errors");
const {
  EmailIntent,
  DocumentStatus,
  ProjectPhase,
  AuditActions,
} = require("@/constants");

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
                        DocumentStatus.PM_REVIEW,
                        DocumentStatus.SENT_TO_CLIENT,
                        DocumentStatus.CLIENT_FEEDBACK,
                      ],
                    },
                  },
                  orderBy: { updatedAt: "desc" },
                  take: 1,
                  include: {
                    currentRevision: true,
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
    // TODO: Use google api from google.js to fetch latest content of the docuemnt and update the snapshot text of the current revision
    const currentDocument = project.documents[0] || null;
    const conversationHistory = email.thread.emails || [];

    logger.info(
      {
        emailId,
        projectId: project.id,
        projectPhase: project.phase,
        hasCurrentDocument: !!currentDocument,
        conversationHistoryLength: conversationHistory.length,
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

    // Build prompt for intent detection
    const prompt = buildIntentDetectionPrompt(context);

    // Define intent schema
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
        .array(z.string())
        .optional()
        .describe(
          "List of specific changes requested (only for DOC_FEEDBACK intent)"
        ),
      reasoning: z
        .string()
        .max(1000)
        .describe("Explanation for the detected intent"),
      requiresAction: z
        .boolean()
        .describe("Whether this email requires system action"),
      suggestedAction: z
        .string()
        .optional()
        .describe("Suggested action to take if requiresAction is true"),
    });

    // Call LLM for structured intent detection
    const intentResult = await llmClient.generateStructured(
      intentSchema,
      prompt,
      systemContext,
      "classification"
    );
    console.log("intentResult", intentResult);

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
      traceId: intentResult.traceId,
      tokenUsage: intentResult.tokenUsage,
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
Document Summary: ${
        context.currentDocument.content?.substring(0, 500) || "Not available"
      }${context.currentDocument.content?.length > 500 ? "..." : ""}
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
    ProjectPhase.BUDGET_TIMELINE
  } and there's a Budget/Timeline document, focus on feedback related to that
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

    // Update email record with detected intent
    await prisma.email.update({
      where: { id: email.id },
      data: {
        intent,
        intentConfidence: intentResult.confidence,
        llmTraceId: intentResult.traceId,
        processed: true,
      },
    });

    // Create audit log for intent detection
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
          correlationId,
        },
        at: new Date(),
      },
    });

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

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: `CLIENT (${email.from})`,
        action: "DOCUMENT_FEEDBACK_RECEIVED",
        details: {
          emailId: email.id,
          documentId: currentDocument.id,
          documentType: currentDocument.type,
          summary: intentResult.summary,
          requestedChanges: intentResult.requestedChanges || [],
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
        correlationId,
      },
      "Document status updated to CLIENT_FEEDBACK - Manual PM review required"
    );

    // TODO: In future iterations, we can add:
    // 1. Automatic document regeneration based on feedback
    // 2. PM notification email with feedback summary
    // 3. Asana task comment with client feedback

    return {
      actionTaken: true,
      intent: EmailIntent.DOC_FEEDBACK,
      message: "Document marked for feedback - PM review required",
      documentId: currentDocument.id,
      documentStatus: DocumentStatus.CLIENT_FEEDBACK,
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
        emailId: email.id,
        projectId: project.id,
        documentId: currentDocument?.id,
        documentType: currentDocument?.type,
        correlationId,
      },
      "Handling ACCEPT intent"
    );

    // Verify there's a document to accept
    if (!currentDocument) {
      logger.warn(
        {
          emailId: email.id,
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
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: `CLIENT (${email.from})`,
        action: "DOCUMENT_ACCEPTED",
        details: {
          emailId: email.id,
          documentId: currentDocument.id,
          documentType: currentDocument.type,
          summary: intentResult.summary,
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
      "Document accepted by client - Next phase workflow should trigger"
    );

    // TODO: In future iterations, implement automatic phase progression:
    // - If Brand Origin accepted → trigger Budget/Timeline generation
    // - If Budget/Timeline accepted → trigger project finalization
    // For now, requires manual PM confirmation as per Implementation Plan

    return {
      actionTaken: true,
      intent: EmailIntent.ACCEPT,
      message: "Document accepted - awaiting PM confirmation for next phase",
      documentId: currentDocument.id,
      documentType: currentDocument.type,
      documentStatus: DocumentStatus.ACCEPTED,
    };
  } catch (error) {
    logger.error(
      {
        emailId: context.email.id,
        error: error.message,
        correlationId,
      },
      "Failed to handle ACCEPT intent"
    );
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

    // Update document status if there's an active document
    if (currentDocument) {
      await prisma.document.update({
        where: { id: currentDocument.id },
        data: {
          status: DocumentStatus.REJECTED,
          updatedAt: new Date(),
        },
      });
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        projectId: project.id,
        actor: `CLIENT (${email.from})`,
        action: "DOCUMENT_REJECTED",
        details: {
          emailId: email.id,
          documentId: currentDocument?.id,
          documentType: currentDocument?.type,
          summary: intentResult.summary,
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
        documentId: currentDocument?.id,
        correlationId,
      },
      "Document/Project rejected by client - PM review required"
    );

    // TODO: Notify PM about rejection
    // TODO: Consider moving project to REJECTED phase (requires PM approval)

    return {
      actionTaken: true,
      intent: EmailIntent.REJECT,
      message: "Rejection detected - PM review required",
      documentId: currentDocument?.id,
      documentStatus: currentDocument ? DocumentStatus.REJECTED : null,
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

module.exports = {
  emailIntentProcessor,
  assembleIntentContext,
  detectEmailIntent,
  handleDetectedIntent,
};
