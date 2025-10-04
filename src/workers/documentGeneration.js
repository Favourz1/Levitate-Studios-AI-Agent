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
const { ActionService } = require("@/services/actionService");
const {
  ValidationError,
  LLMError,
  GoogleError,
  AsanaError,
} = require("@/utils/errors");

const logger = createLogger("worker:documentGeneration");
const prisma = getPrismaClient();
const { appConfig } = require("@/config");
const {
  DocumentType,
  DocumentStatus,
  BrandAssets,
  ActionType,
} = require("@/constants");

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

    // Step 5: Send PM notification email with action tokens
    await sendPMAdminNotificationEmail(
      context,
      documentResult,
      DocumentType.BRAND_ORIGIN,
      correlationId
    );

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
 * Convert brand origin document text into formatted blocks for Google Docs
 * @param {string} documentText - The generated brand origin document text
 * @param {Object} project - Project information
 * @returns {Array} Array of formatted blocks for createFormattedDocument
 */
function convertBrandOriginToFormattedBlocks(documentText, project) {
  const blocks = [];

  try {
    // Add logo at the top
    blocks.push({
      type: "image",
      fileId: BrandAssets.LEVITATE_LOGO_FILE_ID,
      url: BrandAssets.LEVITATE_LOGO_URL, // Fallback URL
      width: BrandAssets.LOGO_DIMENSIONS.WIDTH,
      height: BrandAssets.LOGO_DIMENSIONS.HEIGHT,
    });

    // Add some spacing after logo
    blocks.push({
      type: "spacer",
      height: 24,
    });

    // Add header table with client and document information
    const clientName = project?.client?.name || "Client Name";
    const projectName = project?.name || "Brand Development Project";

    blocks.push({
      type: "table",
      rows: [
        [`Client: ${clientName}`, "Doc: Brand Origins / Creative Brief"],
        [`Project: ${projectName}`, "Task: Generate detailed brand document"],
      ],
      style: {
        borderWidth: 1,
        fontSize: 10,
      },
    });

    // Add spacing after header table
    blocks.push({
      type: "spacer",
      height: 24,
    });

    // Parse the document text and create formatted blocks
    const lines = documentText.split("\n");
    let currentSection = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        // Add minimal spacing for empty lines
        blocks.push({
          type: "spacer",
          height: 6,
        });
        continue;
      }

      // Skip header table lines if they exist in the document
      if (
        line.includes("|") &&
        (line.includes("Client:") ||
          line.includes("Doc:") ||
          line.includes("Project:") ||
          line.includes("Task:"))
      ) {
        continue; // Skip these as we've already added our own header table
      }

      // Check for Roman numeral headings (I., II., III., etc.)
      const romanNumeralMatch = line.match(/^([IVX]+)\.\s*(.+)$/);
      if (romanNumeralMatch) {
        const [, numeral, title] = romanNumeralMatch;

        // Add extra spacing before new sections (except the first one)
        if (blocks.length > 3) {
          // Account for logo, spacer, and header table
          blocks.push({
            type: "spacer",
            height: 18,
          });
        }

        blocks.push({
          type: "heading",
          text: `${numeral}. ${title.toUpperCase()}`,
          level: 2,
          style: {
            bold: true,
            fontSize: 14,
          },
        });
        currentSection = title.toLowerCase();
        continue;
      }

      // Check for "Next Steps" heading (special case)
      if (line.toLowerCase().includes("next steps")) {
        blocks.push({
          type: "spacer",
          height: 18,
        });
        blocks.push({
          type: "heading",
          text: "NEXT STEPS",
          level: 2,
          style: {
            bold: true,
            fontSize: 14,
          },
        });
        continue;
      }

      // Check for sub-headings or bold labels (common in brand origin docs)
      if (line.includes(":") && line.length < 150) {
        const colonIndex = line.indexOf(":");
        const label = line.substring(0, colonIndex + 1);
        const content = line.substring(colonIndex + 1).trim();

        // Check if this looks like a section label (Functional:, Emotional:, etc.)
        const commonLabels = [
          "functional",
          "sensory",
          "emotional",
          "founders",
          "business",
          "perspective",
          "key promise",
          "tone of voice",
          "narrative guidance",
          "musts",
          "must nots",
          "visual",
          "tone",
        ];

        const isLabel = commonLabels.some((labelText) =>
          label.toLowerCase().includes(labelText)
        );

        if (isLabel) {
          if (content) {
            // Label with content on same line - make label bold
            blocks.push({
              type: "styled",
              text: `${label} ${content}`,
              style: {
                bold: true,
              },
            });
          } else {
            // Label only, likely followed by content
            blocks.push({
              type: "styled",
              text: label,
              style: {
                bold: true,
                fontSize: 12,
              },
            });
          }
          continue;
        } else if (content) {
          // Regular line with colon but not a section label
          blocks.push({
            type: "paragraph",
            text: line,
          });
          continue;
        }
      }

      // Check for bullet points (lines starting with -, •, or *)
      if (line.match(/^[-•*]\s+/)) {
        const bulletText = line.replace(/^[-•*]\s+/, "");

        // Look ahead to collect all bullet items
        const bulletItems = [bulletText];
        let j = i + 1;
        while (j < lines.length && lines[j].trim().match(/^[-•*]\s+/)) {
          bulletItems.push(lines[j].trim().replace(/^[-•*]\s+/, ""));
          j++;
        }

        blocks.push({
          type: "bullets",
          items: bulletItems,
        });

        i = j - 1; // Skip the processed lines
        continue;
      }

      // Check for numbered lists
      if (line.match(/^\d+\.\s+/)) {
        const numberedText = line.replace(/^\d+\.\s+/, "");

        // Look ahead to collect all numbered items
        const numberedItems = [numberedText];
        let j = i + 1;
        while (j < lines.length && lines[j].trim().match(/^\d+\.\s+/)) {
          numberedItems.push(lines[j].trim().replace(/^\d+\.\s+/, ""));
          j++;
        }

        blocks.push({
          type: "numbered",
          items: numberedItems,
        });

        i = j - 1; // Skip the processed lines
        continue;
      }

      // Check for special formatting cues
      if (line.includes("**") || line.includes("*")) {
        // Handle markdown-style formatting
        let formattedText = line;
        let isBold = false;
        let isItalic = false;

        if (line.includes("**")) {
          formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, "$1");
          isBold = true;
        } else if (line.includes("*")) {
          formattedText = formattedText.replace(/\*(.*?)\*/g, "$1");
          isItalic = true;
        }

        blocks.push({
          type: "styled",
          text: formattedText,
          style: {
            bold: isBold,
            italic: isItalic,
          },
        });
        continue;
      }

      // Regular paragraph
      blocks.push({
        type: "paragraph",
        text: line,
      });
    }

    // Add final spacing
    blocks.push({
      type: "spacer",
      height: 12,
    });

    logger.info(
      {
        projectId: project?.id,
        originalTextLength: documentText.length,
        blocksCount: blocks.length,
      },
      "Brand origin document converted to formatted blocks"
    );

    return blocks;
  } catch (error) {
    logger.error(
      {
        projectId: project?.id,
        error: error.message,
        documentTextLength: documentText?.length,
      },
      "Failed to convert brand origin document to formatted blocks"
    );

    // Fallback: return simple blocks with logo and text
    return [
      {
        type: "image",
        fileId: BrandAssets.LEVITATE_LOGO_FILE_ID,
        url: BrandAssets.LEVITATE_LOGO_URL, // Fallback URL
        width: BrandAssets.LOGO_DIMENSIONS.WIDTH,
        height: BrandAssets.LOGO_DIMENSIONS.HEIGHT,
      },
      {
        type: "spacer",
        height: 24,
      },
      {
        type: "paragraph",
        text: documentText,
      },
    ];
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
          type: DocumentType.BRAND_ORIGIN,
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

    // Convert brand origin document to formatted blocks
    const formattedBlocks = convertBrandOriginToFormattedBlocks(
      brandOriginDocument.document,
      documentRecord.project
    );

    // Create formatted document with logo, styling, and proper structure
    try {
      googleDoc = await googleIntegration.createFormattedDocument(
        documentRecord.documentTitle,
        formattedBlocks,
        {
          folderId,
          makePublicReadable: false,
          shareWithEmails: [], // PM will be shared separately below
        }
      );
    } catch (formattedDocError) {
      // Fallback to regular document creation if formatted document fails
      logger.warn(
        {
          projectId,
          error: formattedDocError.message,
          correlationId,
        },
        "Formatted document creation failed, falling back to regular document creation"
      );

      googleDoc = await googleIntegration.createDocument(
        documentRecord.documentTitle,
        brandOriginDocument.document,
        {
          folderId,
          makePublicReadable: false,
        }
      );
    }

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
          status: DocumentStatus.PM_REVIEW, // Ready for PM review now that Google Doc exists
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

    // Generate action tokens for PM
    const sendToClientToken = await ActionService.createActionToken(
      {
        action: ActionType.SEND_TO_CLIENT,
        documentId: documentResult.documentId,
        projectId: context.project.id,
        userId: pmUser.id,
        userEmail: pmUser.email,
        userName: pmUser.name,
      },
      "24h"
    );

    const generateLinkToken = await ActionService.createActionToken(
      {
        action: ActionType.GENERATE_SEND_LINK,
        documentId: documentResult.documentId,
        projectId: context.project.id,
        userId: pmUser.id,
        userEmail: pmUser.email,
        userName: pmUser.name,
      },
      "24h"
    );

    const actionTokens = {
      sendToClientToken: sendToClientToken.token,
      generateLinkToken: generateLinkToken.token,
    };

    // Generate email template with action tokens
    // TODO: Create generateBudgetTimelineNotificationTemplate and generateBudgetTimelineVariantNotificationTemplate in emailTemplateService.js
    const emailTemplate = (() => {
      switch (documentType) {
        case DocumentType.BRAND_ORIGIN:
          return EmailTemplateService.generateBrandOriginNotificationTemplate(
            context.project,
            documentResult,
            context.emailThread,
            actionTokens
          );
        case DocumentType.BUDGET_TIMELINE:
          return EmailTemplateService.generateBudgetTimelineNotificationTemplate(
            context.project,
            documentResult,
            context.emailThread,
            actionTokens
          );
        case DocumentType.BUDGET_TIMELINE_VARIANT:
          return EmailTemplateService.generateBudgetTimelineVariantNotificationTemplate(
            context.project,
            documentResult,
            context.emailThread,
            actionTokens
          );
        default:
          return EmailTemplateService.generateBrandOriginNotificationTemplate(
            context.project,
            documentResult,
            context.emailThread,
            actionTokens
          );
      }
    })();

    // Send to PM
    await brevoIntegration.sendTransactionalEmail({
      to: [pmUser.email],
      subject: emailTemplate.subject,
      htmlContent: emailTemplate.htmlContent,
      // Don't use reply-to for internal notifications
    });

    // Also send to admin in production with separate tokens
    if (
      appConfig.server.nodeEnv === "production" &&
      appConfig.server.adminEmail
    ) {
      // Find admin user for tokens
      const adminUser = await prisma.teamMember.findFirst({
        where: {
          email: appConfig.server.adminEmail,
          isActive: true,
        },
      });

      if (adminUser) {
        // Generate separate action tokens for admin
        const adminSendToClientToken = await ActionService.createActionToken(
          {
            action: ActionType.SEND_TO_CLIENT,
            documentId: documentResult.documentId,
            projectId: context.project.id,
            userId: adminUser.id,
            userEmail: adminUser.email,
            userName: adminUser.name,
          },
          "24h"
        );

        const adminGenerateLinkToken = await ActionService.createActionToken(
          {
            action: ActionType.GENERATE_SEND_LINK,
            documentId: documentResult.documentId,
            projectId: context.project.id,
            userId: adminUser.id,
            userEmail: adminUser.email,
            userName: adminUser.name,
          },
          "24h"
        );

        const adminActionTokens = {
          sendToClientToken: adminSendToClientToken.token,
          generateLinkToken: adminGenerateLinkToken.token,
        };

        // Generate admin email template with admin tokens
        const adminEmailTemplate = (() => {
          switch (documentType) {
            case DocumentType.BRAND_ORIGIN:
              return EmailTemplateService.generateBrandOriginNotificationTemplate(
                context.project,
                documentResult,
                context.emailThread,
                adminActionTokens
              );
            case DocumentType.BUDGET_TIMELINE:
              return EmailTemplateService.generateBudgetTimelineNotificationTemplate(
                context.project,
                documentResult,
                context.emailThread,
                adminActionTokens
              );
            case DocumentType.BUDGET_TIMELINE_VARIANT:
              return EmailTemplateService.generateBudgetTimelineVariantNotificationTemplate(
                context.project,
                documentResult,
                context.emailThread,
                adminActionTokens
              );
            default:
              return EmailTemplateService.generateBrandOriginNotificationTemplate(
                context.project,
                documentResult,
                context.emailThread,
                adminActionTokens
              );
          }
        })();

        await brevoIntegration.sendTransactionalEmail({
          to: [appConfig.server.adminEmail],
          subject: adminEmailTemplate.subject,
          htmlContent: adminEmailTemplate.htmlContent,
        });

        logger.info(
          {
            projectId: context.project.id,
            adminEmail: appConfig.server.adminEmail,
            correlationId,
          },
          "Admin notification email sent successfully"
        );
      }
    }

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
    case DocumentType.BRAND_ORIGIN:
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
