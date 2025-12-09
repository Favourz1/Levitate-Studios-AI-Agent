const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError, BaseError } = require("@/utils/errors");
const { parseReplyToAddress, generateDedupeKey } = require("@/utils");
const { QueueService, QUEUE_NAMES } = require("@/queues");
const { brevoIntegration } = require("@/integrations/brevo");
const { googleIntegration } = require("@/integrations/google");
const { EmailTemplateService } = require("@/services/emailTemplateService");
const { appConfig } = require("@/config");

const logger = createLogger("service:email-inbound");
const prisma = getPrismaClient();

/**
 * EmailInboundService handles Brevo inbound webhook processing
 * Processes inbound emails, identifies recipients, and enqueues intent detection jobs
 */
class EmailInboundService {
  /**
   * Extract email alias information from reply-to address
   * Supports patterns like: clients-12-34@reply.levitate.ng
   * Can be extended for other patterns in the future
   * @param {string} emailAddress - Email address to parse
   * @returns {Object|null} Parsed alias information or null
   */
  static extractEmailAlias(emailAddress) {
    try {
      if (!emailAddress || typeof emailAddress !== "string") {
        return null;
      }

      // Pattern for client-project emails: clients-{clientId}-{projectId}@reply.levitate.ng
      const clientProjectPattern = parseReplyToAddress(emailAddress);
      if (clientProjectPattern) {
        return {
          type: "client-project",
          clientId: clientProjectPattern.clientId,
          projectId: clientProjectPattern.projectId,
          originalAddress: emailAddress,
        };
      }

      // Add more patterns here in the future for different email types
      // Example: support-{ticketId}@reply.levitate.ng, etc.

      return null;
    } catch (error) {
      logger.error(
        {
          emailAddress,
          error: error.message,
        },
        "Failed to extract email alias"
      );
      return null;
    }
  }

  /**
   * Validate Brevo inbound webhook payload structure
   * @param {Object} payload - Brevo webhook payload
   * @returns {Object} Validation result
   */
  static validateBrevoPayload(payload) {
    try {
      if (!payload || typeof payload !== "object") {
        return {
          valid: false,
          error: "Payload is required and must be an object",
        };
      }

      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        return {
          valid: false,
          error: "Payload must contain an items array with at least one email",
        };
      }

      // Validate each email item has required fields
      for (let i = 0; i < payload.items.length; i++) {
        const item = payload.items[i];

        if (!item.MessageId) {
          return {
            valid: false,
            error: `Email item ${i} missing MessageId`,
          };
        }

        if (!item.From || !item.From.Address) {
          return {
            valid: false,
            error: `Email item ${i} missing From.Address`,
          };
        }

        if (!Array.isArray(item.To) || item.To.length === 0) {
          return {
            valid: false,
            error: `Email item ${i} missing To array`,
          };
        }
      }

      return {
        valid: true,
        itemCount: payload.items.length,
      };
    } catch (error) {
      logger.error(
        {
          error: error.message,
        },
        "Brevo payload validation failed"
      );
      return {
        valid: false,
        error: `Validation error: ${error.message}`,
      };
    }
  }

  /**
   * Process a single Brevo inbound email item
   * @param {Object} item - Brevo email item
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Processing result
   */
  static async processInboundEmailItem(item, correlationId) {
    const startTime = Date.now();

    try {
      logger.info(
        {
          messageId: item.MessageId,
          from: item.From.Address,
          subject: item.Subject,
          correlationId,
        },
        "Processing inbound email item"
      );

      // Step 1: Check all recipient addresses to find our reply-to addresses
      let matchedAlias = null;
      let matchedToAddress = null;

      // Check To addresses
      for (const toItem of item.To || []) {
        const alias = this.extractEmailAlias(toItem.Address);
        if (alias) {
          matchedAlias = alias;
          matchedToAddress = toItem.Address;
          break;
        }
      }

      // If not found in To, check Cc addresses
      if (!matchedAlias && Array.isArray(item.Cc)) {
        for (const ccItem of item.Cc) {
          const alias = this.extractEmailAlias(ccItem.Address);
          if (alias) {
            matchedAlias = alias;
            matchedToAddress = ccItem.Address;
            break;
          }
        }
      }

      // If not found in To or Cc, check Recipients (RCPT TO)
      if (!matchedAlias && Array.isArray(item.Recipients)) {
        for (const recipient of item.Recipients) {
          const alias = this.extractEmailAlias(recipient);
          if (alias) {
            matchedAlias = alias;
            matchedToAddress = recipient;
            break;
          }
        }
      }

      // If no match found, this email is not for us
      if (!matchedAlias) {
        logger.info(
          {
            messageId: item.MessageId,
            toAddresses: item.To?.map((t) => t.Address),
            ccAddresses: item.Cc?.map((c) => c.Address),
            recipientAddresses: item.Recipients,
            correlationId,
          },
          "No matching reply-to address found in email - skipping"
        );
        return {
          success: true,
          skipped: true,
          reason: "No matching reply-to address",
          messageId: item.MessageId,
        };
      }

      logger.info(
        {
          messageId: item.MessageId,
          aliasType: matchedAlias.type,
          matchedToAddress,
          correlationId,
        },
        "Matched email alias"
      );

      // Step 2: Route to appropriate handler based on alias type
      switch (matchedAlias.type) {
        case "client-project":
          return await this.processClientProjectEmail(
            item,
            matchedAlias,
            matchedToAddress,
            correlationId
          );

        // Add more handlers here for different email types in the future
        default:
          logger.warn(
            {
              messageId: item.MessageId,
              aliasType: matchedAlias.type,
              correlationId,
            },
            "Unknown alias type - skipping"
          );
          return {
            success: true,
            skipped: true,
            reason: `Unknown alias type: ${matchedAlias.type}`,
            messageId: item.MessageId,
          };
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          messageId: item.MessageId,
          error: error.message,
          errorType: error.constructor.name,
          duration,
          correlationId,
          stack: error.stack,
        },
        "Failed to process inbound email item"
      );

      // Don't throw - we want to continue processing other emails
      return {
        success: false,
        error: error.message,
        messageId: item.MessageId,
        processingTime: duration,
      };
    }
  }

  /**
   * Process client-project email (clients-{clientId}-{projectId}@reply.levitate.ng)
   * @param {Object} item - Brevo email item
   * @param {Object} alias - Parsed alias information
   * @param {string} toAddress - Matched to address
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Processing result
   */
  static async processClientProjectEmail(
    item,
    alias,
    toAddress,
    correlationId
  ) {
    try {
      const { clientId, projectId } = alias;

      logger.info(
        {
          messageId: item.MessageId,
          clientId,
          projectId,
          from: item.From.Address,
          correlationId,
        },
        "Processing client-project email"
      );

      // Step 1: Verify client and project exist and are related
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
          emailThreads: {
            where: { replyToAddress: toAddress },
            take: 1,
          },
        },
      });

      if (!project) {
        logger.warn(
          {
            messageId: item.MessageId,
            projectId,
            correlationId,
          },
          "Project not found for inbound email"
        );
        return {
          success: false,
          error: "Project not found",
          messageId: item.MessageId,
          projectId,
        };
      }

      if (project.clientId !== clientId) {
        logger.warn(
          {
            messageId: item.MessageId,
            clientId,
            projectId,
            actualClientId: project.clientId,
            correlationId,
          },
          "Client ID mismatch for inbound email"
        );
        return {
          success: false,
          error: "Client ID mismatch",
          messageId: item.MessageId,
          clientId,
          projectId,
        };
      }

      // Step 2: Get or create email thread
      let emailThread = project.emailThreads[0];
      if (!emailThread) {
        // Create email thread if it doesn't exist
        emailThread = await prisma.emailThread.create({
          data: {
            projectId,
            clientId,
            replyToAddress: toAddress,
            providerThreadId: item.InReplyTo || item.MessageId,
          },
        });

        logger.info(
          {
            emailThreadId: emailThread.id,
            projectId,
            clientId,
            correlationId,
          },
          "Created new email thread"
        );
      }

      // Step 3: Extract email content
      const textBody = item.ExtractedMarkdownMessage || item.RawTextBody || "";
      const htmlBody = item.RawHtmlBody || "";
      const subject = item.Subject || "";

      // Step 4: Store email in database in a transaction
      const emailRecord = await withTransaction(async (tx) => {
        // Create email record
        const email = await tx.email.create({
          data: {
            threadId: emailThread.id,
            direction: "INBOUND",
            fromAddr: item.From.Address,
            toAddr: toAddress,
            subject,
            rawHeaders: item.Headers || {},
            textBody,
            htmlBody,
            attachmentsMeta: item.Attachments
              ? {
                  attachments: item.Attachments.map((att) => ({
                    name: att.Name,
                    contentType: att.ContentType,
                    contentLength: att.ContentLength,
                    contentId: att.ContentID,
                    downloadToken: att.DownloadToken,
                  })),
                }
              : null,
            brevoEventId: item.Uuid?.[0] || null,
            receivedAt: item.SentAtDate ? new Date(item.SentAtDate) : undefined,
            intent: "NONE", // Will be updated by intent detection worker
            intentConfidence: 0,
            llmTraceId: null,
            processed: false,
          },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            projectId,
            actor: `CLIENT (${item.From.Address})`,
            action: "EMAIL_RECEIVED",
            details: {
              emailId: email.id,
              messageId: item.MessageId,
              subject,
              from: item.From.Address,
              hasAttachments: !!item.Attachments?.length,
              correlationId,
            },
          },
        });

        logger.info(
          {
            emailId: email.id,
            threadId: emailThread.id,
            projectId,
            clientId,
            correlationId,
          },
          "Email record created in database"
        );

        return email;
      });

      // Step 5: Send notification to admin immediately (non-blocking)
      setImmediate(() =>
        this.sendAdminNotification(emailRecord, project, item, correlationId)
      );

      // Step 6: Enqueue intent detection job (high priority)
      const dedupeKey = generateDedupeKey(
        QUEUE_NAMES.EMAIL_INTENT,
        emailRecord.id,
        projectId
      );

      const intentJob = await QueueService.addEmailParseJob(
        {
          emailId: emailRecord.id,
          projectId,
          clientId,
          threadId: emailThread.id,
          dedupeKey,
          correlationId,
        },
        2 // High priority
      );

      logger.info(
        {
          emailId: emailRecord.id,
          jobId: intentJob.id,
          projectId,
          clientId,
          correlationId,
        },
        "Intent detection job enqueued"
      );

      return {
        success: true,
        emailId: emailRecord.id,
        threadId: emailThread.id,
        projectId,
        clientId,
        intentJobId: intentJob.id,
        messageId: item.MessageId,
      };
    } catch (error) {
      logger.error(
        {
          messageId: item.MessageId,
          clientId: alias.clientId,
          projectId: alias.projectId,
          error: error.message,
          correlationId,
        },
        "Failed to process client-project email"
      );
      throw error;
    }
  }

  /**
   * Send notification to admin about new client email
   * Downloads attachments from Brevo, uploads to Google Drive, and sends email
   * @param {Object} emailRecord - Email database record
   * @param {Object} project - Project with client info
   * @param {Object} brevoItem - Original Brevo email item
   * @param {string} correlationId - Correlation ID for tracking
   */
  static async sendAdminNotification(
    emailRecord,
    project,
    brevoItem,
    correlationId
  ) {
    try {
      const adminEmail = appConfig.server.adminEmail;

      if (!adminEmail) {
        logger.warn(
          {
            emailId: emailRecord.id,
            correlationId,
          },
          "No admin email configured - skipping notification"
        );
        return;
      }

      // Process attachments if present
      const attachmentLinks = [];
      const brevoAttachments = [];

      if (brevoItem.Attachments && brevoItem.Attachments.length > 0) {
        logger.info(
          {
            emailId: emailRecord.id,
            attachmentCount: brevoItem.Attachments.length,
            correlationId,
          },
          "Processing email attachments"
        );

        // Get documents folder for attachments
        let documentsFolder;
        try {
          documentsFolder = await googleIntegration.ensureDocumentsFolder();
        } catch (folderError) {
          logger.warn(
            {
              emailId: emailRecord.id,
              error: folderError.message,
              correlationId,
            },
            "Failed to get documents folder for attachments - will upload to root"
          );
        }

        // Process each attachment
        for (const attachment of brevoItem.Attachments) {
          try {
            logger.info(
              {
                emailId: emailRecord.id,
                attachmentName: attachment.Name,
                downloadToken: attachment.DownloadToken,
                correlationId,
              },
              "Downloading attachment from Brevo"
            );

            // Download attachment from Brevo
            const downloadResult =
              await brevoIntegration.downloadInboundAttachment(
                attachment.DownloadToken
              );

            logger.info(
              {
                emailId: emailRecord.id,
                attachmentName: attachment.Name,
                bufferSize: downloadResult.buffer.length,
                correlationId,
              },
              "Attachment downloaded successfully, uploading to Google Drive"
            );

            // Upload to Google Drive
            const uploadedFile = await googleIntegration.uploadFileFromBuffer(
              downloadResult.buffer,
              attachment.Name,
              attachment.ContentType,
              documentsFolder?.id
            );

            logger.info(
              {
                emailId: emailRecord.id,
                attachmentName: attachment.Name,
                driveFileId: uploadedFile.id,
                correlationId,
              },
              "Attachment uploaded to Google Drive successfully"
            );

            // Add to attachment links for email template
            attachmentLinks.push({
              name: uploadedFile.name,
              webViewLink: uploadedFile.webViewLink,
              size: uploadedFile.size,
              driveFileId: uploadedFile.id,
            });

            // Add to Brevo attachments for email sending
            brevoAttachments.push({
              name: uploadedFile.name,
              url: uploadedFile.webContentLink,
            });
          } catch (attachmentError) {
            logger.error(
              {
                emailId: emailRecord.id,
                attachmentName: attachment.Name,
                error: attachmentError.message,
                correlationId,
              },
              "Failed to process attachment - continuing with other attachments"
            );
            // Continue processing other attachments
          }
        }

        logger.info(
          {
            emailId: emailRecord.id,
            totalAttachments: brevoItem.Attachments.length,
            processedAttachments: attachmentLinks.length,
            correlationId,
          },
          "Attachment processing completed"
        );
      }

      // Step 6: Get conversation history for context (last 5 emails excluding current)
      // Filter to only show emails to/from client (use client email to filter)
      let conversationHistory = [];
      try {
        const clientEmail = project.client?.primaryEmail?.toLowerCase();

        if (!clientEmail) {
          logger.warn(
            {
              emailId: emailRecord.id,
              projectId: project.id,
              correlationId,
            },
            "No client email found - skipping conversation history"
          );
        } else {
          const emailThread = await prisma.emailThread.findUnique({
            where: { id: emailRecord.threadId },
            include: {
              emails: {
                where: {
                  id: { not: emailRecord.id }, // Exclude current email
                  // Filter to only emails to/from client (case-insensitive contains match)
                  // Using contains to handle comma-separated addresses and display names
                  OR: [
                    {
                      fromAddr: {
                        contains: clientEmail,
                        mode: "insensitive",
                      },
                    },
                    {
                      toAddr: {
                        contains: clientEmail,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
                orderBy: { receivedAt: "desc" },
                take: 5, // Last 5 emails for context
                select: {
                  id: true,
                  direction: true,
                  fromAddr: true,
                  toAddr: true,
                  subject: true,
                  textBody: true,
                  receivedAt: true,
                  intent: true,
                },
              },
            },
          });

          conversationHistory = emailThread?.emails || [];
        }

        logger.info(
          {
            emailId: emailRecord.id,
            threadId: emailRecord.threadId,
            conversationHistoryCount: conversationHistory.length,
            correlationId,
          },
          "Retrieved conversation history for admin notification"
        );
      } catch (historyError) {
        logger.warn(
          {
            emailId: emailRecord.id,
            threadId: emailRecord.threadId,
            error: historyError.message,
            correlationId,
          },
          "Failed to retrieve conversation history - continuing without it"
        );
        // Continue without conversation history - not critical for notification
      }

      // Generate email template using EmailTemplateService
      const emailTemplate =
        EmailTemplateService.generateAdminInboundEmailNotificationTemplate(
          project,
          brevoItem,
          emailRecord,
          attachmentLinks,
          conversationHistory
        );

      // Send email with attachments
      await brevoIntegration.sendTransactionalEmail({
        to: [adminEmail],
        subject: emailTemplate.subject,
        htmlContent: emailTemplate.htmlContent,
        textContent: emailTemplate.textContent,
        attachments: brevoAttachments.length > 0 ? brevoAttachments : undefined,
      });

      logger.info(
        {
          emailId: emailRecord.id,
          adminEmail,
          projectId: project.id,
          attachmentCount: attachmentLinks.length,
          correlationId,
        },
        "Admin notification email sent successfully with attachments"
      );
    } catch (error) {
      logger.error(
        {
          emailId: emailRecord.id,
          error: error.message,
          errorType: error.constructor.name,
          stack: error.stack,
          correlationId,
        },
        "Failed to send admin notification email"
      );
      // Don't throw - this is not critical
    }
  }

  /**
   * Process complete Brevo inbound webhook payload
   * @param {Object} payload - Brevo webhook payload
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Processing results
   */
  static async processBrevoInboundWebhook(payload, correlationId) {
    const startTime = Date.now();

    try {
      logger.info(
        {
          itemCount: payload.items?.length,
          correlationId,
        },
        "Processing Brevo inbound webhook"
      );

      // Step 1: Validate payload
      const validation = this.validateBrevoPayload(payload);
      if (!validation.valid) {
        throw new ValidationError(validation.error);
      }

      // Step 2: Process each email item
      const results = await Promise.allSettled(
        payload.items.map((item) =>
          this.processInboundEmailItem(item, correlationId)
        )
      );

      // Step 3: Aggregate results
      const successful = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      const skipped = successful.filter(
        (r) => r.value.skipped || !r.value.success
      );
      const processed = successful.filter(
        (r) => !r.value.skipped && r.value.success
      );

      const duration = Date.now() - startTime;

      logger.info(
        {
          totalItems: payload.items.length,
          processed: processed.length,
          skipped: skipped.length,
          failed: failed.length,
          duration,
          correlationId,
        },
        "Brevo inbound webhook processing completed"
      );

      return {
        success: true,
        totalItems: payload.items.length,
        processed: processed.length,
        skipped: skipped.length,
        failed: failed.length,
        duration,
        results: results.map((r, i) => ({
          messageId: payload.items[i].MessageId,
          status: r.status,
          result:
            r.status === "fulfilled" ? r.value : { error: r.reason.message },
        })),
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          error: error.message,
          errorType: error.constructor.name,
          duration,
          correlationId,
          stack: error.stack,
        },
        "Brevo inbound webhook processing failed"
      );

      throw error;
    }
  }
}

module.exports = { EmailInboundService };
