const { Router } = require("express");
const crypto = require("crypto");
const { createLogger } = require("@/utils/logger");
const {
  asyncHandler,
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { authenticateActionToken } = require("@/middleware/auth");
const { ActionService } = require("@/services/actionService");
const { DocumentSendingService } = require("@/services/documentSendingService");
const { EmailTemplateService } = require("@/services/emailTemplateService");
const {
  RejectionConfirmationService,
} = require("@/services/rejectionConfirmationService");
const { brevoIntegration } = require("@/integrations/brevo");
const { ValidationError, BaseError } = require("@/utils/errors");
const { appConfig } = require("@/config");
const { ActionType, TeamRole } = require("@/constants");
const { getPrismaClient } = require("@/database");

const router = Router();
const logger = createLogger("routes:actions");
// TODO: Either update urls or add more info in jwt to know if its for brand origin or budget timeline

/**
 * GET /actions/send-to-client?t=<JWT>
 * Send document to client with PDF conversion and email
 */
router.get(
  "/send-to-client",
  authenticateActionToken,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const actionData = req?.actionData; // From authenticateActionToken middleware
    const correlationId = crypto.randomUUID();

    try {
      // Extract and validate action data
      const {
        documentId,
        projectId,
        userId,
        userEmail,
        userName,
        nonce,
        action,
      } = actionData;

      // Validate action type
      if (action !== ActionType.SEND_TO_CLIENT) {
        throw new ValidationError(
          `Invalid action type: ${action}. Expected: ${ActionType.SEND_TO_CLIENT}`
        );
      }

      logger.info(
        {
          documentId,
          projectId,
          userId,
          userName,
          nonce,
          correlationId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
        "Processing send-to-client action"
      );

      // Step 1: Check for idempotency (prevent duplicate sends)
      const existingAction = await ActionService.checkActionNonce(nonce);
      if (existingAction) {
        logger.info(
          {
            nonce,
            processedAt: existingAction.processedAt,
            correlationId,
          },
          "Action already processed (idempotent response)"
        );

        return sendSuccessResponse(res, {
          message: "Document already sent to client",
          alreadyProcessed: true,
          processedAt: existingAction.processedAt,
          status: existingAction.status,
          correlationId,
          processingTime: Date.now() - startTime,
        });
      }

      // Step 2: Validate document status and permissions
      const validation =
        await DocumentSendingService.validateDocumentForSending(
          documentId,
          projectId
        );

      if (!validation.valid) {
        // Handle specific validation errors with appropriate responses
        if (validation.code === "ALREADY_SENT") {
          // Mark nonce as used even for already sent documents to prevent replay
          await ActionService.markActionNonceUsed(nonce, correlationId, {
            action: "SEND_TO_CLIENT",
            result: "ALREADY_SENT",
            documentId,
            projectId,
            userId,
          });

          return sendSuccessResponse(res, {
            message: "Document already sent to client",
            alreadySent: true,
            sentAt: validation.sentAt,
            correlationId,
            processingTime: Date.now() - startTime,
          });
        }

        throw new ValidationError(validation.error);
      }

      // Step 3: Validate team member permissions
      await ActionService.validateTeamMemberPermissions(userId, [
        TeamRole.PROJECT_MANAGER,
        TeamRole.ADMIN,
        TeamRole.MANAGER,
      ]);

      // Step 4: Process the send-to-client action
      const result = await DocumentSendingService.sendDocumentToClient({
        documentId,
        projectId,
        userId,
        correlationId,
      });

      // Step 5: Mark nonce as used
      await ActionService.markActionNonceUsed(nonce, correlationId, {
        action: "SEND_TO_CLIENT",
        result: "SUCCESS",
        documentId,
        projectId,
        userId,
        clientEmail: result.clientEmail,
        pdfFileId: result.pdfFile.id,
      });

      // Step 6: Create audit log entry
      await ActionService.createAuditLog({
        projectId,
        actor: `USER (${userName})`,
        action: "DOCUMENT_SENT_TO_CLIENT_VIA_EMAIL_LINK",
        details: {
          documentId,
          documentType: result.document.type,
          clientEmail: result.clientEmail,
          pdfFileId: result.pdfFile.id,
          pdfName: result.pdfFile.name,
          clickedBy: userName,
          clickedByEmail: userEmail,
          correlationId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          nonce,
        },
      });

      // Step 7: Send feedback email to user who clicked
      try {
        const feedbackTemplate =
          EmailTemplateService.generateActionSuccessFeedbackTemplate({
            to: userEmail,
            userName,
            action: "Document sent to client successfully",
            projectName: result.project.name,
            clientName: result.client.name,
            documentType: result.document.type,
            correlationId,
          });

        await brevoIntegration.sendTransactionalEmail({
          to: [userEmail],
          subject: feedbackTemplate.subject,
          htmlContent: feedbackTemplate.htmlContent,
        });

        logger.info(
          {
            userEmail,
            userName,
            correlationId,
          },
          "Success feedback email sent to user"
        );
      } catch (feedbackError) {
        // Log error but don't fail the main operation
        logger.error(
          {
            userEmail,
            userName,
            error: feedbackError.message,
            correlationId,
          },
          "Failed to send success feedback email"
        );
      }

      // Step 8: Return success response
      const duration = Date.now() - startTime;

      logger.info(
        {
          documentId,
          projectId,
          clientEmail: result.clientEmail,
          pdfFileId: result.pdfFile.id,
          userName,
          duration,
          correlationId,
        },
        "Send-to-client action completed successfully"
      );

      return sendSuccessResponse(res, {
        message: "Document sent to client successfully",
        documentId,
        projectId,
        clientEmail: result.clientEmail,
        pdfFile: {
          id: result.pdfFile.id,
          name: result.pdfFile.name,
          size: result.pdfFile.size,
        },
        sentAt: new Date().toISOString(),
        correlationId,
        processingTime: duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          documentId: actionData?.documentId,
          projectId: actionData?.projectId,
          userId: actionData?.userId,
          userName: actionData?.userName,
          error: error.message,
          errorType: error.constructor.name,
          correlationId,
          duration,
          stack: error.stack,
        },
        "Send-to-client action failed"
      );

      // Send error feedback email to user
      if (actionData?.userEmail && actionData?.userName) {
        try {
          const errorTemplate =
            EmailTemplateService.generateActionErrorFeedbackTemplate({
              to: actionData.userEmail,
              userName: actionData.userName,
              action: "Send document to client",
              error: error.message,
              correlationId,
            });

          await brevoIntegration.sendTransactionalEmail({
            to: [actionData.userEmail],
            subject: errorTemplate.subject,
            htmlContent: errorTemplate.htmlContent,
          });

          logger.info(
            {
              userEmail: actionData.userEmail,
              userName: actionData.userName,
              correlationId,
            },
            "Error feedback email sent to user"
          );
        } catch (feedbackError) {
          logger.error(
            {
              userEmail: actionData.userEmail,
              userName: actionData.userName,
              feedbackError: feedbackError.message,
              correlationId,
            },
            "Failed to send error feedback email"
          );
        }
      }

      return sendErrorResponse(
        res,
        error,
        error instanceof ValidationError ? 400 : 500
      );
    }
  })
);

/**
 * Generate a new send-to-client link for team members
 */
router.get(
  "/generate-send-link",
  authenticateActionToken,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const actionData = req?.actionData; // From authenticateActionToken middleware
    const correlationId = crypto.randomUUID();

    try {
      // Extract and validate action data
      const { documentId, projectId, userId, userEmail, userName, action } =
        actionData;

      // Validate action type
      if (action !== ActionType.GENERATE_SEND_LINK) {
        throw new ValidationError(
          `Invalid action type: ${action}. Expected: ${ActionType.GENERATE_SEND_LINK}`
        );
      }

      logger.info(
        {
          documentId,
          projectId,
          userId,
          userName,
          correlationId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
        "Processing generate-send-link action"
      );

      // Step 1: Validate team member permissions
      await ActionService.validateTeamMemberPermissions(userId, [
        TeamRole.PROJECT_MANAGER,
        TeamRole.ADMIN,
        TeamRole.MANAGER,
      ]);

      // Step 2: Validate document status
      const validation =
        await DocumentSendingService.validateDocumentForSending(
          documentId,
          projectId
        );

      if (!validation.valid && validation.code !== "ALREADY_SENT") {
        throw new ValidationError(validation.error);
      }

      // Step 3: Generate new action token for send-to-client
      const newActionToken = await ActionService.createActionToken(
        {
          action: ActionType.SEND_TO_CLIENT,
          documentId,
          projectId,
          userId,
          userEmail,
          userName,
        },
        "24h"
      );

      const sendToClientUrl = `${appConfig.server.baseUrl}/api/v1/actions/send-to-client?t=${newActionToken.token}`;

      // Step 4: Create audit log entry
      await ActionService.createAuditLog({
        projectId,
        actor: `USER (${userName})`,
        action: "NEW_SEND_LINK_GENERATED",
        details: {
          documentId,
          requestedBy: userName,
          requestedByEmail: userEmail,
          newTokenNonce: newActionToken.nonce,
          correlationId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      });

      // Step 5: Send new link via email
      const project = validation.project;
      const document = validation.document;

      const newLinkTemplate = EmailTemplateService.generateNewSendLinkTemplate({
        to: userEmail,
        userName,
        projectName: project.name,
        documentType: document.type,
        sendToClientUrl,
        correlationId,
      });

      await brevoIntegration.sendTransactionalEmail({
        to: [userEmail],
        subject: newLinkTemplate.subject,
        htmlContent: newLinkTemplate.htmlContent,
      });

      const duration = Date.now() - startTime;

      logger.info(
        {
          documentId,
          projectId,
          userName,
          userEmail,
          newTokenNonce: newActionToken.nonce,
          duration,
          correlationId,
        },
        "New send link generated and emailed successfully"
      );

      return sendSuccessResponse(res, {
        message: "New send link generated and sent to your email",
        documentId,
        projectId,
        linkSentTo: userEmail,
        expiresIn: "24h",
        generatedAt: new Date().toISOString(),
        correlationId,
        processingTime: duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          documentId: actionData?.documentId,
          projectId: actionData?.projectId,
          userId: actionData?.userId,
          userName: actionData?.userName,
          error: error.message,
          errorType: error.constructor.name,
          correlationId,
          duration,
          stack: error.stack,
        },
        "Generate send link action failed"
      );

      return sendErrorResponse(
        res,
        error,
        error instanceof ValidationError ? 400 : 500
      );
    }
  })
);

/**
 * GET /actions/confirm-rejection?t=<JWT>
 * Confirm rejection and execute all required actions
 */
router.get(
  "/confirm-rejection",
  authenticateActionToken,
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const actionData = req?.actionData; // From authenticateActionToken middleware
    const correlationId = crypto.randomUUID();

    try {
      // Extract and validate action data
      const {
        documentId,
        projectId,
        userId,
        userEmail,
        userName,
        nonce,
        action,
        isDocumentLevel,
        emailId,
      } = actionData;

      // Validate action type
      if (action !== ActionType.CONFIRM_REJECTION) {
        throw new ValidationError(
          `Invalid action type: ${action}. Expected: ${ActionType.CONFIRM_REJECTION}`
        );
      }

      logger.info(
        {
          documentId,
          projectId,
          userId,
          userName,
          isDocumentLevel,
          nonce,
          correlationId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
        "Processing confirm-rejection action"
      );

      // Step 1: Check for idempotency (prevent duplicate confirmations)
      const existingAction = await ActionService.checkActionNonce(nonce);
      if (existingAction) {
        logger.info(
          {
            nonce,
            processedAt: existingAction.processedAt,
            correlationId,
          },
          "Action already processed (idempotent response)"
        );

        return sendSuccessResponse(res, {
          message: "Rejection already confirmed",
          alreadyProcessed: true,
          processedAt: existingAction.processedAt,
          status: existingAction.status,
          correlationId,
          processingTime: Date.now() - startTime,
        });
      }

      // Step 2: Validate team member permissions
      await ActionService.validateTeamMemberPermissions(userId, [
        TeamRole.PROJECT_MANAGER,
        TeamRole.ADMIN,
        TeamRole.MANAGER,
      ]);

      // Step 3: Validate required fields
      if (!projectId) {
        throw new ValidationError("Project ID is required");
      }

      if (isDocumentLevel && !documentId) {
        throw new ValidationError(
          "Document ID is required for document-level rejection"
        );
      }

      if (!emailId) {
        throw new ValidationError("Email ID is required");
      }

      // Step 4: Confirm rejection and execute all required actions
      const result = await RejectionConfirmationService.confirmRejection({
        projectId,
        documentId: isDocumentLevel ? documentId : null,
        isDocumentLevel: !!isDocumentLevel,
        userId,
        userName,
        userEmail,
        emailId,
        correlationId,
      });

      // Step 5: Mark nonce as used
      await ActionService.markActionNonceUsed(nonce, correlationId, {
        action: "CONFIRM_REJECTION",
        result: "SUCCESS",
        projectId,
        documentId,
        isDocumentLevel,
        userId,
      });

      // Step 6: Create audit log entry
      await ActionService.createAuditLog({
        projectId,
        actor: `USER (${userName})`,
        action: "REJECTION_CONFIRMED_VIA_EMAIL_LINK",
        details: {
          documentId,
          isDocumentLevel,
          clickedBy: userName,
          clickedByEmail: userEmail,
          correlationId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          nonce,
        },
      });

      // Step 7: Get project data for feedback email
      const prisma = getPrismaClient();
      const projectData = await prisma.project.findUnique({
        where: { id: projectId },
        include: { client: true },
      });

      // Step 8: Send feedback email to user who clicked
      try {
        const feedbackTemplate =
          EmailTemplateService.generateActionSuccessFeedbackTemplate({
            to: userEmail,
            userName,
            action: `${
              isDocumentLevel ? "Document" : "Project"
            } rejection confirmed successfully`,
            projectName: projectData?.name || `Project ${projectId}`,
            clientName: projectData?.client?.name || "N/A",
            documentType: isDocumentLevel ? "Document" : "Project",
            correlationId,
          });

        await brevoIntegration.sendTransactionalEmail({
          to: [userEmail],
          subject: feedbackTemplate.subject,
          htmlContent: feedbackTemplate.htmlContent,
        });

        logger.info(
          {
            userEmail,
            userName,
            correlationId,
          },
          "Success feedback email sent to user"
        );
      } catch (feedbackError) {
        logger.error(
          {
            userEmail,
            userName,
            error: feedbackError.message,
            correlationId,
          },
          "Failed to send success feedback email"
        );
      }

      // Step 8: Return success response
      const duration = Date.now() - startTime;

      logger.info(
        {
          projectId,
          documentId,
          isDocumentLevel,
          userName,
          duration,
          correlationId,
        },
        "Confirm-rejection action completed successfully"
      );

      return sendSuccessResponse(res, {
        message: result.message,
        projectId,
        documentId,
        isDocumentLevel,
        projectPhase: result.projectPhase,
        confirmedAt: new Date().toISOString(),
        correlationId,
        processingTime: duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          documentId: actionData?.documentId,
          projectId: actionData?.projectId,
          userId: actionData?.userId,
          userName: actionData?.userName,
          error: error.message,
          errorType: error.constructor.name,
          correlationId,
          duration,
          stack: error.stack,
        },
        "Confirm-rejection action failed"
      );

      // Send error feedback email to user
      if (actionData?.userEmail && actionData?.userName) {
        try {
          const errorTemplate =
            EmailTemplateService.generateActionErrorFeedbackTemplate({
              to: actionData.userEmail,
              userName: actionData.userName,
              action: "Confirm rejection",
              error: error.message,
              correlationId,
            });

          await brevoIntegration.sendTransactionalEmail({
            to: [actionData.userEmail],
            subject: errorTemplate.subject,
            htmlContent: errorTemplate.htmlContent,
          });

          logger.info(
            {
              userEmail: actionData.userEmail,
              userName: actionData.userName,
              correlationId,
            },
            "Error feedback email sent to user"
          );
        } catch (feedbackError) {
          logger.error(
            {
              userEmail: actionData.userEmail,
              userName: actionData.userName,
              feedbackError: feedbackError.message,
              correlationId,
            },
            "Failed to send error feedback email"
          );
        }
      }

      return sendErrorResponse(
        res,
        error,
        error instanceof ValidationError ? 400 : 500
      );
    }
  })
);

// Keep existing placeholder routes for now
router.get(
  "/review",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Review action" });
  })
);

router.post(
  "/confirm-accepted",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Confirm accepted action" });
  })
);

module.exports = { actionsRouter: router };
