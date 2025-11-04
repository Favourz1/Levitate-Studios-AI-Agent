const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const {
  isValidPhaseTransition,
} = require("@/utils/validation/commonValidation");
const { asanaIntegration } = require("@/integrations/asana");
const {
  AsanaPendingProjectsService,
} = require("@/services/asanaPendingProjectsService");
const { EmailTemplateService } = require("@/services/emailTemplateService");
const { brevoIntegration } = require("@/integrations/brevo");
const {
  DocumentStatus,
  ProjectPhase,
  AuditActions,
  AsanaPendingProjectsBoardSections,
} = require("@/constants");
const { ValidationError } = require("@/utils/errors");
const { appConfig } = require("@/config");

const logger = createLogger("service:rejection-confirmation");
const prisma = getPrismaClient();

/**
 * RejectionConfirmationService handles rejection confirmation workflow
 * Implements all 7 steps of rejection confirmation:
 * 1. Update document status (if document-level)
 * 2. Determine if project-level or document-level rejection
 * 3. If project-level, update project.phase to REJECTED
 * 4. Move Asana task to REJECTED section
 * 5. Add Asana comment with @mention PM
 * 6. Send notification emails to PM and Admin
 * 7. Create comprehensive audit log
 */
class RejectionConfirmationService {
  /**
   * Confirm rejection and execute all required actions
   * @param {Object} params - Confirmation parameters
   * @param {number} params.projectId - Project ID
   * @param {number|null} params.documentId - Document ID (if document-level rejection)
   * @param {boolean} params.isDocumentLevel - Whether this is document-level or project-level rejection
   * @param {string} params.userId - User ID who confirmed the rejection
   * @param {string} params.userName - User name who confirmed
   * @param {string} params.userEmail - User email who confirmed
   * @param {number} params.emailId - Email ID that triggered the rejection
   * @param {string} params.correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Confirmation result
   */
  static async confirmRejection({
    projectId,
    documentId,
    isDocumentLevel,
    userId,
    userName,
    userEmail,
    emailId,
    correlationId,
  }) {
    try {
      logger.info(
        {
          projectId,
          documentId,
          isDocumentLevel,
          userId,
          userName,
          emailId,
          correlationId,
        },
        "Starting rejection confirmation workflow"
      );

      // Step 1 & 2: Get project and document data, determine rejection level
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
        },
      });

      if (!project) {
        throw new ValidationError(`Project not found: ${projectId}`);
      }

      let currentDocument = null;
      if (isDocumentLevel && documentId) {
        currentDocument = await prisma.document.findUnique({
          where: { id: documentId },
        });

        if (!currentDocument) {
          throw new ValidationError(`Document not found: ${documentId}`);
        }

        if (currentDocument.projectId !== projectId) {
          throw new ValidationError(
            `Document ${documentId} does not belong to project ${projectId}`
          );
        }
      }

      // Get email record for context
      const email = await prisma.email.findUnique({
        where: { id: emailId },
        select: {
          id: true,
          fromAddr: true,
          subject: true,
          textBody: true,
          intentMetadata: true,
        },
      });

      // Execute all steps in a transaction for consistency
      const result = await withTransaction(async (tx) => {
        // Step 1: Update document status if document-level rejection
        if (isDocumentLevel && currentDocument) {
          // Check if already rejected
          if (currentDocument.status === DocumentStatus.REJECTED) {
            logger.info(
              {
                documentId: currentDocument.id,
                correlationId,
              },
              "Document already rejected - skipping status update"
            );
          } else {
            await tx.document.update({
              where: { id: currentDocument.id },
              data: {
                status: DocumentStatus.REJECTED,
                updatedAt: new Date(),
              },
            });

            logger.info(
              {
                documentId: currentDocument.id,
                correlationId,
              },
              "Document status updated to REJECTED"
            );
          }
        }

        // Step 3: Update project phase if project-level rejection
        if (!isDocumentLevel) {
          // Check if already rejected
          if (project.phase === ProjectPhase.REJECTED) {
            logger.info(
              {
                projectId,
                correlationId,
              },
              "Project already rejected - skipping phase update"
            );
          } else {
            // Validate phase transition
            if (!isValidPhaseTransition(project.phase, ProjectPhase.REJECTED)) {
              throw new ValidationError(
                `Invalid phase transition from ${project.phase} to REJECTED`
              );
            }

            // Update project phase
            await tx.project.update({
              where: { id: projectId },
              data: {
                phase: ProjectPhase.REJECTED,
                updatedAt: new Date(),
              },
            });

            // Log phase transition
            await tx.projectPhaseLog.create({
              data: {
                projectId,
                fromPhase: project.phase,
                toPhase: ProjectPhase.REJECTED,
                reason: `Project rejected by client. Confirmed by ${userName} (${userEmail})`,
                actor: "USER",
                at: new Date(),
              },
            });

            logger.info(
              {
                projectId,
                fromPhase: project.phase,
                toPhase: ProjectPhase.REJECTED,
                correlationId,
              },
              "Project phase updated to REJECTED"
            );
          }
        }

        // Step 7: Create comprehensive audit log
        await tx.auditLog.create({
          data: {
            projectId,
            actor: `USER (${userName})`,
            action: AuditActions.REJECTION_CONFIRMED,
            details: {
              documentId: currentDocument?.id || null,
              isDocumentLevel,
              projectPhase: isDocumentLevel
                ? project.phase
                : ProjectPhase.REJECTED,
              confirmedBy: userName,
              confirmedByEmail: userEmail,
              confirmedByUserId: userId,
              emailId,
              clientEmail: email?.fromAddr,
              clientReasoning:
                email?.intentMetadata?.reasoning ||
                email?.intentMetadata?.summary,
              correlationId,
            },
            at: new Date(),
          },
        });

        return {
          projectId,
          documentId: currentDocument?.id || null,
          isDocumentLevel,
          projectPhase: isDocumentLevel ? project.phase : ProjectPhase.REJECTED,
        };
      });

      // Step 4 & 5: Update Asana workflow (outside transaction to avoid timeout)
      await this.updateAsanaWorkflow(
        project,
        currentDocument,
        isDocumentLevel,
        email,
        userName,
        correlationId
      );

      // Step 6: Confirmation notifications are handled by the action route

      logger.info(
        {
          projectId,
          documentId: currentDocument?.id,
          isDocumentLevel,
          correlationId,
        },
        "Rejection confirmation workflow completed successfully"
      );

      return {
        success: true,
        ...result,
        message: isDocumentLevel
          ? "Document rejection confirmed successfully"
          : "Project rejection confirmed successfully",
      };
    } catch (error) {
      logger.error(
        {
          projectId,
          documentId,
          isDocumentLevel,
          error: error.message,
          correlationId,
          stack: error.stack,
        },
        "Failed to confirm rejection"
      );

      // Failure notifications are handled by the action route

      throw error;
    }
  }

  /**
   * Update Asana workflow - move task and add comment
   * @param {Object} project - Project data
   * @param {Object|null} currentDocument - Current document data
   * @param {boolean} isDocumentLevel - Whether this is document-level or project-level rejection
   * @param {Object} email - Email data
   * @param {string} userName - User name who confirmed
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<void>}
   */
  static async updateAsanaWorkflow(
    project,
    currentDocument,
    isDocumentLevel,
    email,
    userName,
    correlationId
  ) {
    try {
      // Get pending projects configuration
      const pendingProjectsConfig =
        await AsanaPendingProjectsService.ensureAsanaPendingProjectsBoard();

      if (!pendingProjectsConfig || !pendingProjectsConfig.sections) {
        logger.warn(
          {
            projectId: project.id,
            correlationId,
          },
          "Pending projects configuration not available - skipping Asana workflow update"
        );
        return;
      }

      // Get the task from asanaLinks
      const asanaLink = await prisma.asanaLink.findFirst({
        where: {
          projectId: project.id,
          pendingBoardGid: { not: null },
        },
        include: {
          tasks: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!asanaLink || !asanaLink.tasks || asanaLink.tasks.length === 0) {
        logger.warn(
          {
            projectId: project.id,
            correlationId,
          },
          "No Asana task found for this project - skipping Asana workflow update"
        );
        return;
      }

      const asanaTask = asanaLink.tasks[0];
      if (!asanaTask || !asanaTask.taskGid) {
        logger.warn(
          {
            projectId: project.id,
            correlationId,
          },
          "Asana task GID not found - skipping Asana workflow update"
        );
        return;
      }

      // Step 4: Move task to REJECTED section
      const rejectedSectionGid =
        pendingProjectsConfig.sections[
          AsanaPendingProjectsBoardSections.REJECTED
        ];

      if (!rejectedSectionGid) {
        logger.warn(
          {
            projectId: project.id,
            correlationId,
          },
          "Rejected section not found in configuration - skipping task move"
        );
      } else {
        try {
          await asanaIntegration.moveTaskToSection(
            asanaTask.taskGid,
            pendingProjectsConfig.projectGid,
            rejectedSectionGid
          );

          // Update asanaTask record in database
          await prisma.asanaTask.update({
            where: { id: asanaTask.id },
            data: {
              sectionName: AsanaPendingProjectsBoardSections.REJECTED,
            },
          });

          logger.info(
            {
              projectId: project.id,
              taskGid: asanaTask.taskGid,
              sectionGid: rejectedSectionGid,
              correlationId,
            },
            "Task moved to REJECTED section successfully"
          );
        } catch (moveError) {
          logger.error(
            {
              projectId: project.id,
              taskGid: asanaTask.taskGid,
              error: moveError.message,
              correlationId,
            },
            "Failed to move task to REJECTED section"
          );
          // Continue with comment even if move fails
        }
      }

      // Step 5: Add comment with @mention PM
      const pmUser = await AsanaPendingProjectsService.getPMUser(project.id);

      // Escape HTML to prevent XSS in Asana comments
      const escapeHtml = (text) => {
        if (!text || typeof text !== "string") return text || "";
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#x27;");
      };

      const rejectionType = isDocumentLevel ? "document" : "project";
      const rejectionDetails =
        isDocumentLevel && currentDocument
          ? `Document Type: ${escapeHtml(
              currentDocument.type
            )}<br>Document Status: ${DocumentStatus.REJECTED}`
          : `Project Phase: ${ProjectPhase.REJECTED}`;

      const emailFrom = email?.fromAddr || email?.from || "Unknown";
      const emailSubject = email?.subject || "(no subject)";
      const clientReasoning =
        email?.intentMetadata?.reasoning ||
        email?.intentMetadata?.summary ||
        email?.textBody?.substring(0, 500) ||
        "No reasoning provided";

      const commentContent = `<body>
🚨 <strong>${
        rejectionType.charAt(0).toUpperCase() + rejectionType.slice(1)
      } Rejection Confirmed</strong>

The ${rejectionType} rejection has been confirmed by <strong>${escapeHtml(
        userName
      )}</strong>.

<strong>Rejection Details:</strong>
${rejectionDetails}

<strong>Client Email:</strong> ${escapeHtml(emailFrom)}<br>
<strong>Client Subject:</strong> ${escapeHtml(emailSubject)}<br>
<strong>Confirmed At:</strong> ${new Date().toLocaleDateString("en-NG", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}

<strong>Client's Reasoning:</strong>
${escapeHtml(clientReasoning)}

The ${rejectionType} has been marked as rejected and the task has been moved to the "Rejected" section.

${
  pmUser && pmUser.asanaUserGid
    ? `<a data-asana-gid="${
        pmUser.asanaUserGid
      }" data-asana-type="user">@${escapeHtml(pmUser.name)}</a>`
    : "@PM"
} please review and take appropriate action.
</body>`;

      await asanaIntegration.addTaskComment(asanaTask.taskGid, commentContent);

      logger.info(
        {
          projectId: project.id,
          taskGid: asanaTask.taskGid,
          pmUserGid: pmUser?.asanaUserGid,
          correlationId,
        },
        "Asana workflow updated successfully"
      );
    } catch (error) {
      logger.error(
        {
          projectId: project.id,
          error: error.message,
          correlationId,
        },
        "Failed to update Asana workflow"
      );
      // Don't throw - this shouldn't fail the entire confirmation
    }
  }
}

module.exports = { RejectionConfirmationService };
