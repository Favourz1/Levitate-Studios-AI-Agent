const { withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError } = require("@/utils/errors");
const { ProcessingStatus, ProjectPhase, Actor } = require("@/constants");
const {
  AsanaPendingProjectsService,
} = require("@/services/asanaPendingProjectsService");
const { EmailTemplateService } = require("@/services/emailTemplateService");
const { brevoIntegration } = require("@/integrations/brevo");
const {
  validateAppsScriptSignature,
} = require("@/utils/validation/webhookValidation");
const { validateFormPayload } = require("@/utils/validation/formValidation");

const logger = createLogger("service:form-submission");

/**
 * FormSubmissionService handles the complete workflow for processing questionnaire submissions
 * from validation through processing to async follow-up actions.
 * This service is designed to be used by both webhook endpoints and direct API calls.
 */
class FormSubmissionService {
  /**
   * Helper function to extract client information from questionnaire responses
   * @param {Object} parsedBody - The parsed form submission body
   * @returns {Object} Client information object
   * @private
   */
  static extractClientInfo(parsedBody) {
    const responses = parsedBody.responses || {};
    const respondentEmail = parsedBody.respondentEmail;

    // Common field patterns for company name
    const companyNameKeys = [
      "What is your company name?",
      "Company name",
      "Company Name",
      "Business name",
      "Organization name",
      "Your company name",
    ];

    let companyName = null;
    for (const key of companyNameKeys) {
      if (
        responses[key] &&
        typeof responses[key] === "string" &&
        responses[key].trim()
      ) {
        companyName = responses[key].trim();
        break;
      }
    }

    // Fallback to extract from email domain if no company name found
    if (!companyName && respondentEmail) {
      const emailDomain = respondentEmail.split("@")[1];
      if (
        emailDomain &&
        !["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"].includes(
          emailDomain.toLowerCase()
        )
      ) {
        companyName = emailDomain
          .split(".")[0]
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase());
      }
    }

    // Final fallback
    if (!companyName) {
      companyName = respondentEmail
        ? `Client ${respondentEmail.split("@")[0]}`
        : `Client ${Date.now()}`;
    }

    // Try to find primary email - prefer respondentEmail, then look for email in responses
    let primaryEmail = respondentEmail;
    if (!primaryEmail) {
      const emailKeys = [
        "Email",
        "Email address",
        "Contact email",
        "Your email",
      ];
      for (const key of emailKeys) {
        if (
          responses[key] &&
          typeof responses[key] === "string" &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responses[key])
        ) {
          primaryEmail = responses[key].trim();
          break;
        }
      }
    }

    if (!primaryEmail) {
      throw new ValidationError(
        "No valid email address found in form submission"
      );
    }

    return {
      name: companyName,
      primaryEmail: primaryEmail.toLowerCase(),
      respondentEmail: respondentEmail || primaryEmail,
    };
  }

  /**
   * Helper function to extract project information from questionnaire responses
   * @param {Object} parsedBody - The parsed form submission body
   * @returns {Object} Project information object
   * @private
   */
  static extractProjectInfo(parsedBody) {
    const metadata = parsedBody.metadata || {};
    const responses = parsedBody.responses || {};

    // Use form title as project name with fallback
    let projectName = metadata.formTitle || "New Project";

    // Look for project specific info in responses
    const projectNameKeys = [
      "What do you want this project to be called?",
      "Project name",
      "Project title",
      "What is this project about?",
      "Describe your project",
    ];

    for (const key of projectNameKeys) {
      if (
        responses[key] &&
        typeof responses[key] === "string" &&
        responses[key].trim()
      ) {
        projectName = responses[key].trim();
        break;
      }
    }

    return {
      name: projectName,
      phase: ProjectPhase.QUESTIONNAIRE,
    };
  }

  /**
   * Helper function to generate unique reply-to address
   * @param {number} clientId - Client ID
   * @param {number} projectId - Project ID
   * @returns {string} Reply-to email address
   * @private
   */
  static generateReplyToAddress(clientId, projectId) {
    const { appConfig } = require("@/config");
    const domain = appConfig.emailReplyDomain || "reply.levitate.ng";
    return `clients-${clientId}-${projectId}@${domain}`;
  }

  /**
   * Core form processing function that handles the complete questionnaire submission flow
   * This function is transactional and creates all necessary database records
   *
   * @param {Object} parsedBody - Validated form submission payload
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Processing result with client, project, questionnaire response, and email thread
   * @private
   */
  static async processFormData(parsedBody, correlationId) {
    return await withTransaction(
      async (tx) => {
        logger.info({
          message: "Starting form data processing",
          correlationId,
          formId: parsedBody.metadata.formId,
          responseId: parsedBody.responseId,
        });

        // Step 1: Extract and validate client information
        const clientInfo = this.extractClientInfo(parsedBody);
        logger.debug({ clientInfo, correlationId }, "Extracted client info");

        // Step 2: Create or get existing client
        let client = await tx.client.findFirst({
          where: { primaryEmail: clientInfo.primaryEmail },
        });

        if (client) {
          // Update existing client context if needed
          logger.info(
            {
              clientId: client.id,
              correlationId,
            },
            "Found existing client"
          );

          // Optionally update the client name if it's different and not empty
          if (clientInfo.name && client.name !== clientInfo.name) {
            client = await tx.client.update({
              where: { id: client.id },
              data: {
                name: clientInfo.name,
                updatedAt: new Date(),
              },
            });
          }
        } else {
          // Create new client
          client = await tx.client.create({
            data: {
              name: clientInfo.name,
              primaryEmail: clientInfo.primaryEmail,
              status: "ACTIVE",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          logger.info(
            {
              clientId: client.id,
              correlationId,
            },
            "Created new client"
          );
        }

        // Step 3: Extract project information
        const projectInfo = this.extractProjectInfo(parsedBody);

        // Step 4: Create new project
        const project = await tx.project.create({
          data: {
            clientId: client.id,
            name: projectInfo.name,
            phase: projectInfo.phase,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        logger.info(
          {
            projectId: project.id,
            clientId: client.id,
            correlationId,
          },
          "Created new project"
        );

        // TODO: Set formTitle field in questionnaire_response db table and use here.
        // Step 5: Store questionnaire response
        const questionnaireResponse = await tx.questionnaireResponse.create({
          data: {
            projectId: project.id,
            formId: parsedBody.metadata.formId,
            responseId: parsedBody.responseId,
            responses: parsedBody.responses,
            respondentEmail: clientInfo.respondentEmail,
            submittedAt: new Date(parsedBody.timestamp),
            processedAt: new Date(),
            processingStatus: ProcessingStatus.PROCESSED,
            retryCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        logger.info(
          {
            questionnaireResponseId: questionnaireResponse.id,
            projectId: project.id,
            correlationId,
          },
          "Stored questionnaire response"
        );

        // Step 6: Create email thread with unique reply-to
        const replyToAddress = this.generateReplyToAddress(
          client.id,
          project.id
        );
        const emailThread = await tx.emailThread.create({
          data: {
            projectId: project.id,
            clientId: client.id,
            replyToAddress,
            createdAt: new Date(),
          },
        });

        logger.info(
          {
            emailThreadId: emailThread.id,
            replyToAddress,
            correlationId,
          },
          "Created email thread"
        );

        // Step 7: Log project phase change
        await tx.projectPhaseLog.create({
          data: {
            projectId: project.id,
            fromPhase: null,
            toPhase: ProjectPhase.QUESTIONNAIRE,
            reason: "Form submission received",
            actor: Actor.SYSTEM,
            at: new Date(),
          },
        });

        // Step 8: Create audit log entry
        await tx.auditLog.create({
          data: {
            projectId: project.id,
            actor: "SYSTEM (Form Submission)",
            action: "FORM_SUBMITTED",
            details: {
              formId: parsedBody.metadata.formId,
              responseId: parsedBody.responseId,
              formTitle: parsedBody.metadata.formTitle,
              clientEmail: clientInfo.primaryEmail,
              correlationId,
            },
            at: new Date(),
          },
        });

        // Validate that all required data was created successfully
        if (!client || !client.id) {
          throw new Error("Failed to create or retrieve client");
        }
        if (!project || !project.id) {
          throw new Error("Failed to create project");
        }
        if (!questionnaireResponse || !questionnaireResponse.id) {
          throw new Error("Failed to create questionnaire response");
        }
        if (!emailThread || !emailThread.id) {
          throw new Error("Failed to create email thread");
        }
        if (!replyToAddress) {
          throw new Error("Failed to generate reply-to address");
        }

        return {
          client,
          project,
          questionnaireResponse,
          emailThread,
          replyToAddress,
        };
      },
      { timeout: 30000 } // 30 seconds timeout for complex multi-operation transaction
    );
  }

  /**
   * Validates that the processed data contains all required components
   * Used for additional safety checks before proceeding with async operations
   *
   * @param {Object} processedData - Result from processFormData
   * @throws {ValidationError} If any required data is missing or invalid
   * @public
   */
  static validateProcessedData(processedData) {
    if (!processedData) {
      throw new ValidationError("processedData is required");
    }

    const { client, project, emailThread } = processedData;

    // Validate required data exists
    if (!client || !client.id || !client.name) {
      throw new ValidationError("Invalid client data provided");
    }
    if (!project || !project.id || !project.name) {
      throw new ValidationError("Invalid project data provided");
    }
    if (!emailThread || !emailThread.replyToAddress) {
      throw new ValidationError("Invalid email thread data provided");
    }
  }

  /**
   * Enqueue brand origin document generation job
   * @param {number} projectId - Project ID
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<void>}
   * @private
   */
  static async enqueueBrandOriginGeneration(projectId, correlationId) {
    const { QueueService } = require("@/queues");
    const { retry } = require("@/utils");
    const { brevoIntegration } = require("@/integrations/brevo");
    const { appConfig } = require("@/config");

    const jobData = {
      projectId,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    try {
      const job = await retry(
        async () => {
          return QueueService.addBrandOriginGenerationJob(jobData, 1); // High priority
        },
        3,
        1000
      );

      logger.info(
        {
          jobId: job.id,
          projectId,
          correlationId,
        },
        "Brand origin generation job enqueued successfully"
      );

      return job;
    } catch (error) {
      logger.error(
        {
          projectId,
          correlationId,
          error: error.message,
        },
        "Failed to enqueue brand origin generation job"
      );
      // Don't throw error - this shouldn't fail the main request
      // The document can be generated manually later if needed

      // Notify admin via email on persistent failure
      try {
        await brevoIntegration.sendTransactionalEmail({
          to: [appConfig.server.adminEmail],
          subject: `Brand Origin Generation Job Failed: Project ID: ${projectId}`,
          htmlContent: `
            <p>Failed to enqueue the brand origin generation job after 3 retry attempts.</p>
            <ul>
              <li>Project ID: ${projectId}</li>
              <li>Correlation ID: ${correlationId}</li>
              <li>Error: ${error.message}</li>
            </ul>
            <p>This requires manual attention. Notify your developer if issue persists.</p>
          `,
        });
      } catch (notifyErr) {
        logger.error(
          {
            projectId,
            correlationId,
            notifyErr: notifyErr.message,
          },
          "Failed to send admin notification email for brand origin enqueue failure"
        );
      }
      // No throw here!
    }
  }

  /**
   * Send PM notification email for new questionnaire submissions
   * @param {Object} client - Client data
   * @param {Object} project - Project data
   * @param {Object} emailThread - Email thread data
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<void>}
   * @private
   */
  static async sendPMNotification(client, project, emailThread, correlationId) {
    try {
      // Get PM email address
      const pmMember = await AsanaPendingProjectsService.getPMUser(project?.id);

      if (!pmMember || !pmMember.email) {
        logger.warn("No PM email found for notification");
        return;
      }
      const { appConfig } = require("@/config");
      // Generate email template using EmailTemplateService
      const template =
        EmailTemplateService.generateQuestionnaireSubmissionNotificationTemplate(
          client,
          project,
          emailThread
        );

      await brevoIntegration.sendTransactionalEmail({
        to: [pmMember.email, appConfig.server.adminEmail],
        subject: template.subject,
        htmlContent: template.htmlContent,
        // replyTo: emailThread.replyToAddress,
      });

      logger.info(
        {
          pmEmail: pmMember.email,
          projectId: project.id,
          correlationId,
        },
        "PM notification email sent successfully"
      );
    } catch (error) {
      logger.error(
        {
          error: error.message,
          correlationId,
        },
        "Failed to send PM notification email"
      );
      // Don't throw error - this is a notification, not a critical failure
    }
  }

  /**
   * Handle async processing tasks (Asana task creation and notifications)
   * This runs in the background for webhook requests or synchronously for API requests
   *
   * @param {Object} processedData - Result from form processing
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Async processing result
   * @private
   */
  static async handleAsyncProcessing(processedData, correlationId) {
    try {
      logger.info({
        message: "Starting async processing",
        correlationId,
        projectId: processedData.project.id,
      });

      // Validate processed data before proceeding
      this.validateProcessedData(processedData);

      // Step 1: Create Asana task in Pending Projects board
      const asanaResult =
        await AsanaPendingProjectsService.createPendingProjectTask(
          processedData,
          correlationId
        );

      logger.info({
        message: "Asana task created successfully",
        correlationId,
        projectId: processedData.project.id,
        asanaTaskGid: asanaResult.asanaTaskGid,
        pendingProjectGid: asanaResult.pendingProjectGid,
      });

      // Step 2: Send PM notification email
      await this.sendPMNotification(
        processedData.client,
        processedData.project,
        processedData.emailThread,
        correlationId
      );

      logger.info({
        message: "Async processing completed successfully",
        correlationId,
        projectId: processedData.project.id,
        asanaTaskGid: asanaResult.asanaTaskGid,
      });

      // Step 3: Start immediate background job for creating brand origin document
      await this.enqueueBrandOriginGeneration(
        processedData.project.id,
        correlationId
      );

      return {
        success: true,
        asanaTaskGid: asanaResult.asanaTaskGid,
        pendingProjectGid: asanaResult.pendingProjectGid,
        brandOriginJobEnqueued: true,
      };
    } catch (error) {
      logger.error({
        message: "Async processing failed",
        correlationId,
        projectId: processedData.project.id,
        error: error.message,
        stack: error.stack,
      });

      // Don't throw error for async processing failures
      // Log the error but don't fail the main request
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process a complete form submission workflow including validation, processing,
   * and async follow-up actions (Asana task creation and notifications)
   *
   * @param {Object} requestData - Request data containing body and headers
   * @param {string} correlationId - Correlation ID for tracking
   * @param {boolean} skipAsyncProcessing - Whether to skip async processing (for API calls)
   * @returns {Promise<Object>} Processing result with client, project, and processing metadata
   * @public
   */
  static async processFormSubmission(
    requestData,
    correlationId,
    skipAsyncProcessing = false
  ) {
    const startTime = Date.now();
    let parsedBody = null;

    try {
      logger.info({
        message: "Starting form submission processing",
        correlationId,
        skipAsyncProcessing,
      });

      // Step 1: Validate webhook signature (only for webhook requests)
      if (requestData.isWebhook) {
        logger.debug({
          message: "Validating webhook signature",
          correlationId,
        });
        validateAppsScriptSignature(requestData.req);
      }

      // Step 2: Parse and validate payload
      if (requestData.isWebhook) {
        // For webhook requests, parse from raw buffer
        try {
          const rawBodyString = requestData.req.rawBodyBuffer.toString("utf8");
          parsedBody = JSON.parse(rawBodyString);
        } catch (jsonError) {
          logger.error({
            message: "JSON parsing failed",
            correlationId,
            jsonError: jsonError.message,
          });
          throw new ValidationError(
            `Invalid JSON payload: ${jsonError.message}`
          );
        }
      } else {
        // For API requests, body is already parsed
        parsedBody = requestData.body;
      }

      // Step 3: Validate form payload structure
      validateFormPayload(parsedBody);

      logger.info({
        message: "Payload validation passed",
        correlationId,
        formId: parsedBody.metadata.formId,
        formTitle: parsedBody.metadata.formTitle,
        responseId: parsedBody.responseId,
      });

      // Step 4: Process form submission (database operations)
      const processedData = await this.processFormData(
        parsedBody,
        correlationId
      );

      logger.info({
        message: "Form data processing completed successfully",
        correlationId,
        clientId: processedData.client.id,
        projectId: processedData.project.id,
      });

      const result = {
        success: true,
        correlationId,
        responseId: parsedBody.responseId,
        formId: parsedBody.metadata.formId,
        clientId: processedData.client.id,
        projectId: processedData.project.id,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        processedData, // Include for async processing
      };

      // Step 5: Handle async processing if not skipped
      if (!skipAsyncProcessing) {
        setImmediate(() =>
          this.handleAsyncProcessing(processedData, correlationId)
        );
        // Use setImmediate for webhook requests to not block response
        // Use await for API requests to ensure completion
        // if (requestData.isWebhook) {
        //   setImmediate(() =>
        //     this.handleAsyncProcessing(processedData, correlationId)
        //   );
        // } else {
        //   await this.handleAsyncProcessing(processedData, correlationId);
        //   result.asyncProcessingCompleted = true;
        // }
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error({
        message: "Form submission processing failed",
        correlationId,
        error: error.message,
        errorType: error.constructor.name,
        processingTime: duration,
        formId: parsedBody?.metadata?.formId,
        responseId: parsedBody?.responseId,
        stack: error.stack,
      });

      throw error; // Re-throw for the caller to handle
    }
  }

  /**
   * Process form submission from webhook request
   * This is optimized for webhook scenarios with immediate response and background processing
   *
   * @param {Object} req - Express request object
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Processing result
   * @public
   */
  static async processWebhookSubmission(req, correlationId) {
    const requestData = {
      isWebhook: true,
      req,
    };

    return await this.processFormSubmission(requestData, correlationId, false);
  }

  /**
   * Process form submission from API request
   * This is optimized for API scenarios with synchronous processing
   *
   * @param {Object} body - Request body (already parsed)
   * @param {string} correlationId - Correlation ID for tracking
   * @param {boolean} skipAsyncProcessing - Whether to skip async processing
   * @returns {Promise<Object>} Processing result
   * @public
   */
  static async processAPISubmission(
    body,
    correlationId,
    skipAsyncProcessing = false
  ) {
    const requestData = {
      isWebhook: false,
      body,
    };

    return await this.processFormSubmission(
      requestData,
      correlationId,
      skipAsyncProcessing
    );
  }
}

module.exports = { FormSubmissionService };
