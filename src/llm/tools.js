const { tool } = require("ai");
const { z } = require("zod");
const { getPrismaClient } = require("@/database");
const { googleIntegration } = require("@/integrations/google");
const { brevoIntegration } = require("@/integrations/brevo");
const { asanaIntegration } = require("@/integrations/asana");
const { QueueService } = require("@/queues");
const { createLogger } = require("@/utils/logger");
const { NotFoundError, ValidationError } = require("@/utils/errors");
const { generateDedupeKey, isFinancialDocument } = require("@/utils");
const { appConfig } = require("@/config");
const {
  DocumentStatus,
  ProjectPhase,
  DocumentType,
  JobType,
} = require("@/constants");

const logger = createLogger("llm:tools");
const prisma = getPrismaClient();

// Tool for reading project context and data
const readProjectContextTool = tool({
  description:
    "Read project context, client information, and related data for LLM processing",
  parameters: z.object({
    projectId: z.number().int().positive(),
    includeDocuments: z.boolean().default(true),
    includeEmails: z.boolean().default(false),
    includeAuditLog: z.boolean().default(false),
  }),
  execute: async ({
    projectId,
    includeDocuments,
    includeEmails,
    includeAuditLog,
  }) => {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
          documents: includeDocuments
            ? {
                include: {
                  revisions: {
                    orderBy: { createdAt: "desc" },
                    take: 3, // Latest 3 revisions
                  },
                },
              }
            : false,
          emailThreads: includeEmails
            ? {
                include: {
                  emails: {
                    orderBy: { receivedAt: "desc" },
                    take: 10, // Latest 10 emails
                  },
                },
              }
            : false,
          auditLogs: includeAuditLog
            ? {
                orderBy: { at: "desc" },
                take: 20, // Latest 20 audit entries
              }
            : false,
        },
      });

      if (!project) {
        throw new NotFoundError("Project", projectId);
      }

      return {
        project: {
          id: project.id,
          name: project.name,
          phase: project.phase,
          context: project.context,
          client: {
            name: project.client.name,
            email: project.client.primaryEmail,
            context: project.client.context,
          },
        },
        documents: project.documents?.map((doc) => ({
          id: doc.id,
          type: doc.type,
          status: doc.status,
          latestRevision: doc.revisions?.[0]
            ? {
                text: doc.revisions[0].snapshotText,
                summary: doc.revisions[0].summary,
                createdAt: doc.revisions[0].createdAt,
                createdBy: doc.revisions[0].createdBy,
              }
            : null,
        })),
        emails: project.emailThreads?.flatMap((thread) =>
          thread.emails.map((email) => ({
            id: email.id,
            direction: email.direction,
            subject: email.subject,
            textBody: email.textBody,
            intent: email.intent,
            intentConfidence: email.intentConfidence,
            receivedAt: email.receivedAt,
          }))
        ),
        auditLog: project.auditLogs?.map((log) => ({
          actor: log.actor,
          action: log.action,
          details: log.details,
          at: log.at,
        })),
      };
    } catch (error) {
      logger.error({ projectId, error }, "Failed to read project context");
      throw error;
    }
  },
});

// Tool for reading document snapshots
const readDocumentSnapshotsTool = tool({
  description: "Read document revision snapshots for comparison and context",
  parameters: z.object({
    documentId: z.number().int().positive(),
    limit: z.number().int().positive().default(5),
  }),
  execute: async ({ documentId, limit }) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
          revisions: {
            orderBy: { createdAt: "desc" },
            take: limit,
          },
          project: {
            include: { client: true },
          },
        },
      });

      if (!document) {
        throw new NotFoundError("Document", documentId);
      }

      return {
        document: {
          id: document.id,
          type: document.type,
          status: document.status,
          project: {
            name: document.project.name,
            phase: document.project.phase,
            client: document.project.client.name,
          },
        },
        revisions: document.revisions.map((revision) => ({
          id: revision.id,
          text: revision.snapshotText,
          summary: revision.summary,
          createdBy: revision.createdBy,
          createdAt: revision.createdAt,
        })),
      };
    } catch (error) {
      logger.error({ documentId, error }, "Failed to read document snapshots");
      throw error;
    }
  },
});

// Tool for creating/updating documents
const writeDocumentTool = tool({
  description: "Create or update a document with new content",
  parameters: z.object({
    projectId: z.number().int().positive(),
    documentType: z.enum(Object.values(DocumentType)),
    content: z.string().min(1),
    title: z.string().max(200),
    summary: z.string().max(500).optional(),
  }),
  execute: async ({ projectId, documentType, content, title, summary }) => {
    try {
      // Prepare sharing emails - include general team gmail for non-financial documents
      const shareEmails = [];
      if (appConfig.generalTeamGmail && !isFinancialDocument(documentType)) {
        shareEmails.push({
          email: appConfig.generalTeamGmail,
          role: "reader",
          options: { sendNotification: false },
        });
      }

      // Create Google Doc
      const googleDoc = await googleIntegration.createDocument(title, content, {
        shareWithEmails: shareEmails,
      });

      // Create document record
      const document = await prisma.document.create({
        data: {
          projectId,
          type: documentType,
          status: DocumentStatus.DRAFT,
          driveFileId: googleDoc.id,
        },
      });

      // Create first revision
      const revision = await prisma.documentRevision.create({
        data: {
          documentId: document.id,
          snapshotText: content,
          summary: summary || "Initial document creation",
          createdBy: "AGENT",
        },
      });

      // Update document to point to current revision
      await prisma.document.update({
        where: { id: document.id },
        data: { currentRevisionId: revision.id },
      });

      logger.info(
        {
          documentId: document.id,
          projectId,
          documentType,
          googleDocId: googleDoc.id,
        },
        "Document created successfully"
      );

      return {
        documentId: document.id,
        googleDocId: googleDoc.id,
        webViewLink: googleDoc.webViewLink,
        revisionId: revision.id,
      };
    } catch (error) {
      logger.error(
        { projectId, documentType, error },
        "Failed to write document"
      );
      throw error;
    }
  },
});

// Tool for creating document variants
const createDocumentVariantTool = tool({
  description: "Create variant documents for quote with different approaches",
  parameters: z.object({
    baseDocumentId: z.number().int().positive(),
    variantContent: z
      .array(
        z.object({
          title: z.string().max(200),
          content: z.string().min(1),
          summary: z.string().max(300),
        })
      )
      .min(1)
      .max(3),
  }),
  execute: async ({ baseDocumentId, variantContent }) => {
    try {
      const baseDocument = await prisma.document.findUnique({
        where: { id: baseDocumentId },
        include: { project: true },
      });

      if (!baseDocument) {
        throw new NotFoundError("Document", baseDocumentId);
      }

      const variants = await Promise.all(
        variantContent.map(async (variant, index) => {
          // Prepare sharing emails - do not share financial variants with general team
          const shareEmails = [];
          if (
            appConfig.generalTeamGmail &&
            !isFinancialDocument(DocumentType.QUOTE_VARIANT)
          ) {
            shareEmails.push({
              email: appConfig.generalTeamGmail,
              role: "reader",
              options: { sendNotification: false },
            });
          }

          const googleDoc = await googleIntegration.createDocument(
            variant.title,
            variant.content,
            {
              shareWithEmails: shareEmails,
            }
          );

          const document = await prisma.document.create({
            data: {
              projectId: baseDocument.projectId,
              type: DocumentType.QUOTE_VARIANT,
              status: DocumentStatus.DRAFT,
              driveFileId: googleDoc.id,
            },
          });

          const revision = await prisma.documentRevision.create({
            data: {
              documentId: document.id,
              snapshotText: variant.content,
              summary: variant.summary,
              createdBy: "AGENT",
            },
          });

          await prisma.document.update({
            where: { id: document.id },
            data: { currentRevisionId: revision.id },
          });

          return {
            documentId: document.id,
            googleDocId: googleDoc.id,
            webViewLink: googleDoc.webViewLink,
            title: variant.title,
          };
        })
      );

      logger.info(
        {
          baseDocumentId,
          variantCount: variants.length,
          projectId: baseDocument.projectId,
        },
        "Document variants created successfully"
      );

      return { variants };
    } catch (error) {
      logger.error(
        { baseDocumentId, error },
        "Failed to create document variants"
      );
      throw error;
    }
  },
});

// Tool for posting Asana comments
const postAsanaCommentTool = tool({
  description: "Post a comment to an Asana task with optional @mentions",
  parameters: z.object({
    taskGid: z.string().min(1),
    htmlText: z.string().min(1).max(20000),
    mentionUserGids: z
      .array(
        z.object({
          gid: z.string(),
          name: z.string(),
        })
      )
      .optional(),
  }),
  execute: async ({ taskGid, htmlText, mentionUserGids }) => {
    try {
      // Add @mentions if provided
      if (mentionUserGids && mentionUserGids.length > 0) {
        for (const user of mentionUserGids) {
          htmlText = htmlText.replace(
            new RegExp(`@${user.name}`, "g"),
            `<a data-asana-gid="${user.gid}" data-asana-type="user">@${user.name}</a>`
          );
        }
      }

      const comment = await asanaIntegration.addTaskComment(taskGid, htmlText);

      logger.info(
        {
          taskGid,
          commentGid: comment.gid,
          mentionCount: mentionUserGids?.length || 0,
        },
        "Asana comment posted successfully"
      );

      return {
        commentGid: comment.gid,
        createdAt: comment.created_at,
      };
    } catch (error) {
      logger.error({ taskGid, error }, "Failed to post Asana comment");
      throw error;
    }
  },
});

// Tool for sending emails
const sendEmailTool = tool({
  description: "Send transactional email via Brevo",
  parameters: z.object({
    to: z.array(z.string().email()),
    subject: z.string().min(1).max(300),
    content: z.string().min(1),
    templateId: z.number().int().positive().optional(),
    params: z.record(z.unknown()).optional(),
    replyTo: z.string().email().optional(),
  }),
  execute: async ({ to, subject, content, templateId, params, replyTo }) => {
    try {
      const emailData = {
        to,
        subject,
        htmlContent: content,
        templateId,
        params,
        replyTo,
      };

      const result = await brevoIntegration.sendTransactionalEmail(emailData);

      logger.info(
        {
          messageId: result.messageId,
          recipientCount: to.length,
          templateId,
        },
        "Email sent successfully"
      );

      return {
        messageId: result.messageId,
        recipientCount: to.length,
      };
    } catch (error) {
      logger.error({ to, subject, error }, "Failed to send email");
      throw error;
    }
  },
});

// Tool for advancing project state
const advanceProjectStateTool = tool({
  description:
    "Advance project to next phase with proper validation and side effects",
  parameters: z.object({
    projectId: z.number().int().positive(),
    newPhase: z.enum([
      ProjectPhase.QUESTIONNAIRE,
      ProjectPhase.BRAND_ORIGIN,
      ProjectPhase.QUOTE_DOCUMENT,
      ProjectPhase.ASANA_INIT,
      ProjectPhase.WORKPLAN_GENERATION,
      ProjectPhase.FINALIZED,
      ProjectPhase.REJECTED,
    ]),
    reason: z.string().max(500),
    actor: z.enum(["SYSTEM", "USER", "LLM"]).default("LLM"),
  }),
  execute: async ({ projectId, newPhase, reason, actor }) => {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        throw new NotFoundError("Project", projectId);
      }

      // Update project phase
      const updatedProject = await prisma.project.update({
        where: { id: projectId },
        data: { phase: newPhase },
      });

      // Log the phase change
      await prisma.projectPhaseLog.create({
        data: {
          projectId,
          fromPhase: project.phase,
          toPhase: newPhase,
          reason,
          actor,
        },
      });

      // Create audit log entry
      await prisma.auditLog.create({
        data: {
          projectId,
          actor: `${actor}:LLM_TOOL`,
          action: "PHASE_CHANGE",
          details: {
            fromPhase: project.phase,
            toPhase: newPhase,
            reason,
          },
        },
      });

      logger.info(
        {
          projectId,
          fromPhase: project.phase,
          toPhase: newPhase,
          actor,
        },
        "Project phase advanced successfully"
      );

      return {
        projectId,
        fromPhase: project.phase,
        toPhase: newPhase,
        updatedAt: updatedProject.updatedAt,
      };
    } catch (error) {
      logger.error(
        { projectId, newPhase, error },
        "Failed to advance project state"
      );
      throw error;
    }
  },
});

// Tool for enqueueing background jobs
const enqueueJobTool = tool({
  description: "Enqueue background jobs for asynchronous processing",
  parameters: z.object({
    jobType: z.enum([
      "document-generation",
      "email-parse",
      "asana-sync",
      "asana-project-init",
      "notification",
      "snapshot-sync",
    ]),
    jobData: z.record(z.unknown()),
    priority: z.number().int().min(0).max(10).default(0),
  }),
  execute: async ({ jobType, jobData, priority }) => {
    try {
      let job;
      const dedupeKey = generateDedupeKey(
        jobType,
        "llm-tool",
        Date.now().toString()
      );

      switch (jobType) {
        case JobType.DOCUMENT_GENERATION:
          job = await QueueService.addDocumentGenerationJob(
            { ...jobData, dedupeKey },
            priority
          );
          break;
        case JobType.EMAIL_PARSE:
          job = await QueueService.addEmailParseJob(
            { ...jobData, dedupeKey },
            priority
          );
          break;
        case JobType.ASANA_SYNC:
          job = await QueueService.addAsanaSyncJob(
            { ...jobData, dedupeKey },
            priority
          );
          break;
        case JobType.ASANA_PROJECT_INIT:
          job = await QueueService.addAsanaProjectInitJob(
            { ...jobData, dedupeKey },
            priority
          );
          break;
        case JobType.NOTIFICATION:
          job = await QueueService.addNotificationJob(
            { ...jobData, dedupeKey },
            priority
          );
          break;
        case JobType.SNAPSHOT_SYNC:
          job = await QueueService.addSnapshotSyncJob(
            { ...jobData, dedupeKey },
            priority
          );
          break;
        default:
          throw new ValidationError(`Unknown job type: ${jobType}`);
      }

      logger.info(
        {
          jobType,
          jobId: job.id,
          priority,
          dedupeKey,
        },
        "Job enqueued successfully"
      );

      return {
        jobId: job.id,
        jobType,
        dedupeKey,
        priority,
      };
    } catch (error) {
      logger.error({ jobType, jobData, error }, "Failed to enqueue job");
      throw error;
    }
  },
});

// Export all tools
const llmTools = {
  readProjectContext: readProjectContextTool,
  readDocumentSnapshots: readDocumentSnapshotsTool,
  writeDocument: writeDocumentTool,
  createDocumentVariant: createDocumentVariantTool,
  postAsanaComment: postAsanaCommentTool,
  sendEmail: sendEmailTool,
  advanceProjectState: advanceProjectStateTool,
  enqueueJob: enqueueJobTool,
};

module.exports = {
  readProjectContextTool,
  readDocumentSnapshotsTool,
  writeDocumentTool,
  createDocumentVariantTool,
  postAsanaCommentTool,
  sendEmailTool,
  advanceProjectStateTool,
  enqueueJobTool,
  llmTools,
};
