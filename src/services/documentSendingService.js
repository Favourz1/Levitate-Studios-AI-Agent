const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError, GoogleError, BaseError } = require("@/utils/errors");
const { googleIntegration } = require("@/integrations/google");
const { brevoIntegration } = require("@/integrations/brevo");
const { erpIntegration } = require("@/integrations/levitateStudiosErp");
const { EmailTemplateService } = require("@/services/emailTemplateService");
const { DocumentStatus, SystemEmails, DocumentType } = require("@/constants");
const { appConfig } = require("@/config");

const logger = createLogger("service:document-sending");
const prisma = getPrismaClient();

/**
 * DocumentSendingService handles the complete workflow of sending documents to clients
 * Includes PDF conversion, email sending, and database updates
 */
class DocumentSendingService {
  /**
   * Send document to client with PDF conversion and email
   * @param {Object} params - Send parameters
   * @param {number} params.documentId - Document ID to send
   * @param {number} params.projectId - Project ID
   * @param {number} params.userId - User ID performing the action
   * @param {string} params.correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Send result with client and project info
   */
  static async sendDocumentToClient({
    documentId,
    projectId,
    userId,
    correlationId,
  }) {
    try {
      // Validate inputs
      if (!documentId || typeof documentId !== "number") {
        throw new ValidationError(
          "Document ID is required and must be a number"
        );
      }

      if (!projectId || typeof projectId !== "number") {
        throw new ValidationError(
          "Project ID is required and must be a number"
        );
      }

      if (!userId || typeof userId !== "number") {
        throw new ValidationError("User ID is required and must be a number");
      }

      if (!correlationId || typeof correlationId !== "string") {
        throw new ValidationError(
          "Correlation ID is required and must be a string"
        );
      }

      logger.info(
        {
          documentId,
          projectId,
          userId,
          correlationId,
        },
        "Starting document send to client workflow"
      );

      // Execute the complete workflow in a transaction
      const result = await withTransaction(async (tx) => {
        // Step 1: Get document and project info with all related data
        const document = await tx.document.findUnique({
          where: { id: documentId },
          include: {
            project: {
              include: {
                client: true,
                emailThreads: {
                  take: 1,
                  orderBy: { createdAt: "desc" },
                },
              },
            },
            currentRevision: true,
          },
        });

        if (!document) {
          throw new ValidationError(`Document not found: ${documentId}`);
        }

        if (document.projectId !== projectId) {
          throw new ValidationError(
            `Document ${documentId} does not belong to project ${projectId}`
          );
        }

        if (document.status === DocumentStatus.SENT_TO_CLIENT) {
          throw new ValidationError(
            `Document ${documentId} has already been sent to client`
          );
        }

        if (!document.driveFileId) {
          throw new ValidationError(
            `Document ${documentId} does not have a Google Drive file ID`
          );
        }

        const project = document.project;
        const client = project.client;
        const emailThread = project.emailThreads[0];

        if (!emailThread) {
          throw new ValidationError(
            `No email thread found for project ${projectId}`
          );
        }

        logger.info(
          {
            documentId,
            projectId,
            clientId: client.id,
            clientEmail: client.primaryEmail,
            documentStatus: document.status,
            correlationId,
          },
          "Document and project validation completed"
        );

        // Step 2: Export document as PDF (outside transaction to avoid timeout)
        // We'll do this after the transaction but before updating status
        return {
          document,
          project,
          client,
          emailThread,
          needsPdfExport: true,
        };
      });

      // Step 3: Export document to PDF or retrieve quote PDF (outside transaction)
      let pdfFile;
      try {
        if (result.document.type === DocumentType.QUOTE) {
          // For QUOTE documents, download PDF from ERP using selectedQuoteId
          if (!result.document.selectedQuoteId) {
            throw new ValidationError(
              "No quote selected for sending. A quote variant must be selected before sending."
            );
          }

          logger.info(
            {
              documentId,
              selectedQuoteId: result.document.selectedQuoteId,
              correlationId,
            },
            "Downloading quote PDF from ERP"
          );

          // Download PDF from ERP
          const pdfBuffer = await erpIntegration.getQuotationPDF(
            result.document.selectedQuoteId
          );

          // Get documents folder
          const documentsFolder =
            await googleIntegration.ensureDocumentsFolder();

          // Upload PDF to Google Drive
          const pdfName =
            `QUOTE_${result.project.client.name}_${result.project.name}_${result.document.selectedQuoteId}`.replace(
              /[^a-zA-Z0-9_-]/g,
              "_"
            );

          pdfFile = await googleIntegration.uploadFileFromBuffer(
            pdfBuffer,
            pdfName,
            "application/pdf",
            documentsFolder.id
          );

          logger.info(
            {
              documentId,
              selectedQuoteId: result.document.selectedQuoteId,
              pdfFileId: pdfFile.id,
              pdfName: pdfFile.name,
              correlationId,
            },
            "Quote PDF uploaded to Google Drive"
          );
        } else {
          // For BRAND_ORIGIN documents, export from Google Docs as before
          const documentsFolder =
            await googleIntegration.ensureDocumentsFolder();

          const pdfName =
            `${result.document.type}_${result.project.client.name}_${result.project.name}`.replace(
              /[^a-zA-Z0-9_-]/g,
              "_"
            );

          logger.info(
            {
              documentId,
              googleDocId: result.document.driveFileId,
              pdfName,
              folderId: documentsFolder.id,
              correlationId,
            },
            "Starting PDF export from Google Docs"
          );

          pdfFile = await googleIntegration.exportDocumentAsPdf(
            result.document.driveFileId,
            pdfName,
            documentsFolder.id
          );

          logger.info(
            {
              documentId,
              pdfFileId: pdfFile.id,
              pdfName: pdfFile.name,
              pdfSize: pdfFile.size,
              correlationId,
            },
            "PDF export completed successfully"
          );
        }

        // Share PDF with client (no notifications)
        await googleIntegration.shareDocument(pdfFile.id, [
          {
            email: result.client.primaryEmail,
            role: "reader",
            options: {
              sendNotification: false,
            },
          },
        ]);

        logger.info(
          {
            documentId,
            pdfFileId: pdfFile.id,
            clientEmail: result.client.primaryEmail,
            correlationId,
          },
          "PDF shared with client"
        );

        // Make PDF publicly readable so clients with non-Gmail emails can access it
        try {
          await googleIntegration.makeDocumentPublicReadable(pdfFile.id);
          logger.info(
            {
              documentId,
              pdfFileId: pdfFile.id,
              clientEmail: result.client.primaryEmail,
              correlationId,
            },
            "PDF made publicly readable for client access"
          );
        } catch (publicError) {
          // Log warning but don't fail - sharing with client email should still work
          logger.warn(
            {
              documentId,
              pdfFileId: pdfFile.id,
              clientEmail: result.client.primaryEmail,
              error: publicError.message,
              correlationId,
            },
            "Failed to make PDF publicly readable, but document is still shared with client email"
          );
        }
      } catch (pdfError) {
        logger.error(
          {
            documentId,
            documentType: result.document.type,
            selectedQuoteId: result.document.selectedQuoteId,
            googleDocId: result.document.driveFileId,
            error: pdfError.message,
            correlationId,
          },
          "PDF export/download failed"
        );

        const errorType =
          result.document.type === DocumentType.QUOTE
            ? "Quote PDF download from ERP failed"
            : "PDF export from Google Docs failed";

        throw new GoogleError(
          `${errorType} during document sending`,
          pdfError,
          {
            documentId,
            documentType: result.document.type,
            googleDocId: result.document.driveFileId,
            selectedQuoteId: result.document.selectedQuoteId,
            correlationId,
          }
        );
      }

      // Step 4: Send email to client (must succeed before DB update)
      let emailSent = false;
      let clientEmailTemplate;
      try {
        clientEmailTemplate =
          EmailTemplateService.generateClientDocumentEmailTemplate(
            result.project,
            result.document,
            pdfFile,
            result.emailThread
          );

        await brevoIntegration.sendTransactionalEmail({
          senderEmail: `info@${appConfig.emailDomain}`,
          to: [result.client.primaryEmail],
          subject: clientEmailTemplate.subject,
          htmlContent: clientEmailTemplate.htmlContent,
          replyTo: result.emailThread.replyToAddress,
          attachments: [
            {
              name: pdfFile.name,
              url: pdfFile.webContentLink,
            },
          ],
        });

        emailSent = true;

        logger.info(
          {
            documentId,
            projectId,
            clientEmail: result.client.primaryEmail,
            pdfFileId: pdfFile.id,
            replyToAddress: result.emailThread.replyToAddress,
            correlationId,
          },
          "Client email sent successfully"
        );
      } catch (emailError) {
        logger.error(
          {
            documentId,
            projectId,
            clientEmail: result.client.primaryEmail,
            error: emailError.message,
            correlationId,
          },
          "Failed to send email to client"
        );
        throw new BaseError(
          `Failed to send email to client: ${emailError.message}`,
          500,
          "EMAIL_SEND_FAILED",
          {
            documentId,
            projectId,
            clientEmail: result.client.primaryEmail,
            correlationId,
          }
        );
      }

      // Step 5: Update database only after successful email send
      const finalResult = await withTransaction(async (tx) => {
        // Update document status
        const updatedDocument = await tx.document.update({
          where: { id: documentId },
          data: {
            status: DocumentStatus.SENT_TO_CLIENT,
            updatedAt: new Date(),
          },
        });

        // Update current revision's snapshot with latest content
        // Only for BRAND_ORIGIN documents (Google Docs), not QUOTE documents (PDFs)
        try {
          if (
            result.document.currentRevisionId &&
            result.document.type === DocumentType.BRAND_ORIGIN
          ) {
            const latestContent = await googleIntegration.exportDocumentAsText(
              result.document.driveFileId
            );
            await tx.documentRevision.update({
              where: { id: result.document.currentRevisionId },
              data: {
                snapshotText: latestContent,
              },
            });

            logger.info(
              {
                documentId,
                revisionId: result.document.currentRevisionId,
                correlationId,
              },
              "Updated current revision snapshot with latest content"
            );
          } else if (result.document.type === DocumentType.QUOTE) {
            logger.debug(
              {
                documentId,
                documentType: result.document.type,
                correlationId,
              },
              "Skipping text export for QUOTE document (PDF, not Google Doc)"
            );
          }
        } catch (snapshotError) {
          logger.error(
            {
              documentId,
              revisionId: result.document.currentRevisionId,
              error: snapshotError.message,
              correlationId,
            },
            "Failed to update current revision snapshot, continuing with PDF revision"
          );
        }

        // Create document revision for PDF
        const pdfRevision = await tx.documentRevision.create({
          data: {
            documentId: documentId,
            driveRevisionId: pdfFile.id, // Store PDF file ID as revision
            snapshotText: `PDF version exported: ${pdfFile.name}`,
            snapshotMd: {
              pdfFileId: pdfFile.id,
              pdfName: pdfFile.name,
              pdfSize: pdfFile.size,
              sourceRevisionId: result.document.currentRevisionId, // Track source revision
              exportedAt: new Date().toISOString(),
              sentToClient: true,
              clientEmail: result.client.primaryEmail,
            },
            summary: `Document exported as PDF and sent to client: ${result.client.primaryEmail}`,
            createdBy: "SYSTEM",
            createdAt: new Date(),
          },
        });

        // Update document to track the last sent revision (PDF revision)
        await tx.document.update({
          where: { id: documentId },
          data: {
            lastSentRevisionId: pdfRevision.id,
            updatedAt: new Date(),
          },
        });
        // Log outbound email in database
        await tx.email.create({
          data: {
            threadId: result.emailThread.id,
            direction: "OUTBOUND",
            fromAddr: SystemEmails.AI_AGENT,
            toAddr: result.client.primaryEmail,
            subject: clientEmailTemplate.subject,
            htmlBody: clientEmailTemplate.htmlContent,
            textBody: `Document sent: ${result.document.type} for ${result.project.name}`,
            rawHeaders: {
              replyTo: result.emailThread.replyToAddress,
              correlationId,
            },
            attachmentsMeta: {
              attachments: [
                {
                  name: pdfFile.name,
                  fileId: pdfFile.id,
                  size: pdfFile.size,
                  mimeType: "application/pdf",
                },
              ],
            },
            brevoEventId: null, // Brevo will provide this
            receivedAt: new Date(),
            intent: "NONE",
            intentConfidence: 1.0,
            processed: true,
          },
        });

        // Create audit log entry
        await tx.auditLog.create({
          data: {
            projectId,
            actor: `USER (${userId})`,
            action: "DOCUMENT_SENT_TO_CLIENT",
            details: {
              documentId,
              documentType: result.document.type,
              clientEmail: result.client.primaryEmail,
              pdfFileId: pdfFile.id,
              pdfName: pdfFile.name,
              sentBy: userId,
              correlationId,
              emailSent: true,
            },
            at: new Date(),
          },
        });

        logger.info(
          {
            documentId,
            projectId,
            clientEmail: result.client.primaryEmail,
            newStatus: DocumentStatus.SENT_TO_CLIENT,
            pdfFileId: pdfFile.id,
            correlationId,
          },
          "Document send workflow completed successfully"
        );

        return {
          document: updatedDocument,
          project: result.project,
          client: result.client,
          pdfFile,
          emailSent: true,
          clientEmail: result.client.primaryEmail,
        };
      });

      return finalResult;
    } catch (error) {
      logger.error(
        {
          documentId,
          projectId,
          userId,
          error: error.message,
          errorType: error.constructor.name,
          correlationId,
        },
        "Document send workflow failed"
      );
      throw error;
    }
  }

  /**
   * Check if document can be sent to client
   * @param {number} documentId - Document ID to check
   * @param {number} projectId - Project ID to verify
   * @returns {Promise<Object>} Document status and validation result
   */
  static async validateDocumentForSending(documentId, projectId) {
    try {
      const document = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
          project: {
            include: {
              client: true,
              emailThreads: {
                take: 1,
                orderBy: { createdAt: "desc" },
              },
            },
          },
        },
      });

      if (!document) {
        return {
          valid: false,
          error: "Document not found",
          code: "DOCUMENT_NOT_FOUND",
        };
      }

      if (document.projectId !== projectId) {
        return {
          valid: false,
          error: "Document does not belong to specified project",
          code: "PROJECT_MISMATCH",
        };
      }

      if (document.status === DocumentStatus.SENT_TO_CLIENT) {
        return {
          valid: false,
          error: "Document already sent to client",
          code: "ALREADY_SENT",
          sentAt: document.updatedAt,
        };
      }

      // Validate document is in appropriate status for sending
      const allowedStatusesForSending = {
        [DocumentType.BRAND_ORIGIN]: [
          DocumentStatus.PM_REVIEW,
          DocumentStatus.CLIENT_FEEDBACK, // Allow resending after feedback
        ],
        [DocumentType.QUOTE]: [
          DocumentStatus.FINANCE_MANAGER_REVIEW,
          DocumentStatus.CLIENT_FEEDBACK, // Allow resending after feedback
        ],
      };

      const allowedStatuses = allowedStatusesForSending[document.type] || [];
      if (
        allowedStatuses.length > 0 &&
        !allowedStatuses.includes(document.status)
      ) {
        return {
          valid: false,
          error: `Document must be in ${allowedStatuses.join(
            " or "
          )} status before sending. Current status: ${document.status}`,
          code: "INVALID_STATUS",
          currentStatus: document.status,
          allowedStatuses,
        };
      }

      // For QUOTE documents, check if a quote has been selected
      if (document.type === DocumentType.QUOTE) {
        if (!document.selectedQuoteId) {
          return {
            valid: false,
            error:
              "No quote variant selected. Please select a quote before sending to client.",
            code: "NO_QUOTE_SELECTED",
          };
        }
      } else {
        // For BRAND_ORIGIN documents, check if Google Drive file exists
        if (!document.driveFileId) {
          return {
            valid: false,
            error: "Document does not have Google Drive file",
            code: "NO_DRIVE_FILE",
          };
        }
      }

      if (
        !document.project.emailThreads ||
        document.project.emailThreads.length === 0
      ) {
        return {
          valid: false,
          error: "No email thread found for project",
          code: "NO_EMAIL_THREAD",
        };
      }

      return {
        valid: true,
        document,
        project: document.project,
        client: document.project.client,
        emailThread: document.project.emailThreads[0],
      };
    } catch (error) {
      logger.error(
        {
          documentId,
          projectId,
          error: error.message,
        },
        "Failed to validate document for sending"
      );
      throw error;
    }
  }
}

module.exports = { DocumentSendingService };
