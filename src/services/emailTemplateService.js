const { appConfig } = require("@/config");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("service:email-template");

/**
 * EmailTemplateService handles all email template generation and management
 * Centralizes email content creation for consistent messaging across the application
 */
class EmailTemplateService {
  /**
   * Generate PM notification email template for new questionnaire submissions
   * @param {Object} client - Client data
   * @param {Object} project - Project data
   * @param {Object} emailThread - Email thread data
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateQuestionnaireSubmissionNotificationTemplate(
    client,
    project,
    emailThread
  ) {
    try {
      const subject = `New Project Questionnaire: ${client.name} - ${project.name}`;
      const htmlContent = `
        <h2>New Questionnaire Submission Received</h2>
        
        <h3>Client Information</h3>
        <ul>
          <li><strong>Company:</strong> ${client.name}</li>
          <li><strong>Email:</strong> ${client.primaryEmail}</li>
          <li><strong>Project:</strong> ${project.name}</li>
        </ul>
        
        <h3>Next Steps</h3>
        <p>A new questionnaire has been submitted and is ready for review. The system will automatically generate a brand origin document and inform PM assigned to the project.</p>
        
        <!-- <p>
          <a href="${appConfig.server.frontendUrl}/admin/projects/${project.id}" 
             style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Review Project →
          </a>
        </p> -->
        
        <h3>Communication</h3>
        <p><strong>Client Reply-to:</strong> ${emailThread.replyToAddress}</p>
        
        <hr>
        <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
      `;

      logger.debug({
        message: "Generated PM notification template",
        clientId: client.id,
        projectId: project.id,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate PM notification template",
        error: error.message,
        clientId: client?.id,
        projectId: project?.id,
      });
      throw error;
    }
  }

  /**
   * Generate project initialization completion notification template
   * @param {Object} project - Project data
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateProjectInitializationTemplate(project) {
    try {
      const subject = `Project Initialized: ${project.name}`;
      const htmlContent = `
        <h2>Project 100% Initialized</h2>
        
        <h3>Project Details</h3>
        <ul>
          <li><strong>Project:</strong> ${project.name}</li>
          <li><strong>Client:</strong> ${project.client?.name || "N/A"}</li>
          <li><strong>Phase:</strong> ${project.phase || "N/A"}</li>
          <li><strong>Initialized:</strong> ${new Date().toLocaleDateString(
            "en-NG",
            {
              day: "numeric",
              month: "long",
              year: "numeric",
            }
          )}</li>
        </ul>
        
        <h3>Project Resources</h3>
        <p>The project has been fully initialized with tasks assigned to team members and project documentation completed.</p>
        
        <hr>
        <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
      `;

      logger.debug({
        message: "Generated project initialization template",
        projectId: project.id,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate project initialization template",
        error: error.message,
        projectId: project?.id,
      });
      throw error;
    }
  }

  /**
   * Generate document review notification template
   * @param {Object} document - Document data
   * @param {Object} project - Project data
   * @param {string} documentType - Type of document (brand_origin, budget_timeline)
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateDocumentReviewTemplate(document, project, documentType) {
    try {
      const documentTypeName =
        documentType === "brand_origin" ? "Brand Origin" : "Budget/Timeline";
      const subject = `${documentTypeName} Document Ready for Review: ${project.name}`;

      const htmlContent = `
        <h2>${documentTypeName} Document Created</h2>
        
        <h3>Project Details</h3>
        <ul>
          <li><strong>Project:</strong> ${project.name}</li>
          <li><strong>Client:</strong> ${project.client?.name || "N/A"}</li>
          <li><strong>Document Type:</strong> ${documentTypeName}</li>
          <li><strong>Created:</strong> ${new Date().toLocaleDateString(
            "en-NG",
            {
              day: "numeric",
              month: "long",
              year: "numeric",
            }
          )}</li>
        </ul>
        
        <h3>Next Steps</h3>
        <p>A ${documentTypeName.toLowerCase()} document has been generated and is ready for your review.</p>
        
        <p>
          <a href="#" 
             style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px;">
            Review Document →
          </a>
          <a href="#" 
             style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Send to Client →
          </a>
        </p>
        
        <hr>
        <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
      `;

      logger.debug({
        message: "Generated document review template",
        documentId: document.id,
        projectId: project.id,
        documentType,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate document review template",
        error: error.message,
        documentId: document?.id,
        projectId: project?.id,
        documentType,
      });
      throw error;
    }
  }

  /**
   * Generate brand origin document notification template for PM with Review/Send buttons
   * @param {Object} project - Project data
   * @param {Object} documentResult - Created document information
   * @param {Object} emailThread - Email thread data
   * @param {Object} actionTokens - Action tokens for buttons
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateBrandOriginNotificationTemplate(
    project,
    documentResult,
    emailThread,
    actionTokens = {}
  ) {
    try {
      const subject = `Brand Origin Document Ready: ${
        project.client?.name || project.name
      }`;

      // Generate action URLs
      // TODO: Either update urls or add more info in jwt to know if its for brand origin or budget timeline
      const reviewUrl = documentResult.webViewLink; // Direct Google Docs link
      const sendToClientUrl = actionTokens.sendToClientToken
        ? `${appConfig.server.baseUrl}/api/v1/actions/send-to-client?t=${actionTokens.sendToClientToken}`
        : "#";
      const generateNewLinkUrl = actionTokens.generateLinkToken
        ? `${appConfig.server.baseUrl}/api/v1/actions/generate-send-link?t=${actionTokens.generateLinkToken}`
        : "#";

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e1e5e9; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
            .btn { display: inline-block; padding: 12px 24px; margin: 10px 5px; text-decoration: none; border-radius: 5px; font-weight: 600; text-align: center; }
            .btn-primary { background-color: #007bff; color: white; }
            .btn-success { background-color: #28a745; color: white; }
            .btn:hover { opacity: 0.9; }
            .project-info { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .icon { font-size: 24px; margin-right: 10px; }
            .next-steps { background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1><span class="icon">🎨</span>Brand Origin Document Ready</h1>
              <p>AI-generated brand strategy document is ready for your review</p>
            </div>
            
            <div class="content">
              <div class="project-info">
                <h3>📋 Project Details</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Client:</strong> ${
                    project.client?.name || "Unknown Client"
                  }</li>
                  <li><strong>Project:</strong> ${project.name}</li>
                  <li><strong>Document:</strong> Brand Origin / Creative Brief</li>
                  <li><strong>Status:</strong> <span style="background: #ffc107; color: #212529; padding: 2px 8px; border-radius: 12px; font-size: 12px;">DRAFT</span></li>
                  <li><strong>Created:</strong> ${new Date().toLocaleDateString(
                    "en-NG",
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }
                  )}</li>
                </ul>
              </div>

              <div class="next-steps">
                <h3><span class="icon">⚡</span>Next Steps</h3>
                <p>The AI agent has successfully generated a comprehensive brand origin document based on the client's questionnaire responses. This document provides strategic foundation for all creative work.</p>
                
                <ol>
                  <li><strong>Review the document</strong> for accuracy and strategic alignment</li>
                  <li><strong>Edit directly in Google Docs</strong> if changes are needed</li>
                  <li><strong>Send to client from this email</strong> when ready for client review</li>
                </ol>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${reviewUrl}" class="btn btn-success" target="_blank" style="color: white;">
                  <span class="icon">📄</span>Review Document
                </a>
                <a href="${sendToClientUrl}" class="btn btn-primary" style="color: white;">
                  <span class="icon">📧</span>Send to Client
                </a>
                <a href="${generateNewLinkUrl}" class="btn" style="background-color: #6c757d; color: white;">
                  <span class="icon">🔗</span>Get New Send Link
                </a>
              </div>

              <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <p style="margin: 0;"><strong>💡 Quick Actions & Info:</strong></p>
                <ul style="margin: 10px 0;">
                  <li><strong>Google Doc:</strong> <a href="${reviewUrl}" target="_blank">Open in Google Docs</a></li>
                  <li><strong>Send to Client:</strong> Click the blue button above to convert to PDF and email to client</li>
                  <li><strong>Get New Link:</strong> If the send link expires, use the gray button to generate a new one</li>
                  ${
                    emailThread
                      ? `<li><strong>Client Email:</strong> ${emailThread.replyToAddress}</li>`
                      : ""
                  }
                </ul>
              </div>
            </div>
            
            <div class="footer">
              <p style="margin: 0; color: #6c757d; font-size: 14px;">
                <strong>Levitate Studios AI Agent</strong><br>
                This is an automated notification. The document is ready for your review and action.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      logger.debug({
        message: "Generated brand origin notification template",
        projectId: project.id,
        documentId: documentResult.documentId,
        clientName: project.client?.name,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate brand origin notification template",
        error: error.message,
        projectId: project?.id,
        documentId: documentResult?.documentId,
      });
      throw error;
    }
  }

  /**
   * Generate PM notification email template for brand origin document regeneration
   * @param {Object} project - Project data
   * @param {Object} documentResult - Document result data
   * @param {Object} emailThread - Email thread data
   * @param {Object} actionTokens - Action tokens for buttons
   * @param {Object} feedbackContext - Feedback context from client
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateBrandOriginRegenerationNotificationTemplate(
    project,
    documentResult,
    emailThread,
    actionTokens = {},
    feedbackContext = {}
  ) {
    try {
      const subject = `🔄 Brand Origin Document Regenerated - ${
        project.client?.name || "Client"
      } - ${project.name}`;

      const reviewUrl = actionTokens.generateLinkToken
        ? `${appConfig.server.baseUrl}/actions/review?t=${actionTokens.generateLinkToken}`
        : "#";

      const sendToClientUrl = actionTokens.sendToClientToken
        ? `${appConfig.server.baseUrl}/actions/send-to-client?t=${actionTokens.sendToClientToken}`
        : "#";

      const intentResult = feedbackContext.intentResult || {};
      const requestedChanges = intentResult.requestedChanges || [];

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ff9a56 0%, #ff6b6b 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e1e5e9; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
            .btn { display: inline-block; padding: 12px 24px; margin: 10px 5px; text-decoration: none; border-radius: 5px; font-weight: 600; text-align: center; }
            .btn-primary { background-color: #007bff; color: white; }
            .btn-success { background-color: #28a745; color: white; }
            .btn:hover { opacity: 0.9; }
            .project-info { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .feedback-info { background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107; }
            .icon { font-size: 24px; margin-right: 10px; }
            .next-steps { background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin: 20px 0; }
            .changes-list { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; }
            .intent-info { background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #28a745; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1><span class="icon">🔄</span>Brand Origin Document Regenerated</h1>
              <p>AI has regenerated the brand strategy document based on client feedback</p>
            </div>
            
            <div class="content">
              <div class="project-info">
                <h3>📋 Project Details</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Client:</strong> ${
                    project.client?.name || "Unknown Client"
                  }</li>
                  <li><strong>Project:</strong> ${project.name}</li>
                  <li><strong>Document:</strong> Brand Origin Document</li>
                  <li><strong>Status:</strong> <span style="color: #28a745; font-weight: bold;">Regenerated & Ready for Review</span></li>
                </ul>
              </div>

              <div class="intent-info">
                <h3>🤖 AI Intent Detection Results</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Detected Intent:</strong> ${
                    intentResult.summary || "No summary available"
                  }</li>
                  <li><strong>Confidence Level:</strong> ${Math.round(
                    (intentResult.confidence || 0) * 100
                  )}%</li>
                  <li><strong>Client Sentiment:</strong> ${
                    intentResult.clientSentiment || "Not analyzed"
                  }</li>
                  <li><strong>Urgency Level:</strong> ${
                    intentResult.urgency || "Not specified"
                  }</li>
                </ul>
              </div>

              <div class="feedback-info">
                <h3>💬 Client Feedback Summary</h3>
                <p><strong>Summary:</strong> ${
                  intentResult.summary || "No summary available"
                }</p>
                
                ${
                  requestedChanges.length > 0
                    ? `
                <div class="changes-list">
                  <h4>📝 Specific Changes Implemented:</h4>
                  <ol>
                    ${requestedChanges
                      .map(
                        (change, index) => `
                      <li>
                        <strong>${
                          change.section ? `[${change.section}]` : "[General]"
                        }</strong> ${change.change}
                        ${
                          change.priority
                            ? `<br><small><em>Priority: ${change.priority}</em></small>`
                            : ""
                        }
                      </li>
                    `
                      )
                      .join("")}
                  </ol>
                </div>
                `
                    : "<p><em>General improvements based on client feedback</em></p>"
                }
              </div>

              <div class="next-steps">
                <h3>🎯 Next Steps</h3>
                <ol>
                  <li><strong>Review</strong> the regenerated document for feedback integration</li>
                  <li><strong>Verify</strong> that client concerns have been addressed</li>
                  <li><strong>Edit</strong> directly in Google Docs if further refinements are needed</li>
                  <li><strong>Send to Client</strong> when satisfied with the regenerated version</li>
                </ol>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${
                  documentResult.webViewLink
                }" class="btn btn-primary" style="color: white;">
                  <span class="icon">🔍</span>Review Regenerated Document
                </a>
                <a href="${sendToClientUrl}" class="btn btn-success" style="color: white;">
                  <span class="icon">📧</span>Send to Client
                </a>
              </div>

              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h4>📄 Document Access</h4>
                <p><strong>Google Docs:</strong> <a href="${
                  documentResult.webViewLink || "#"
                }" target="_blank">View Document</a></p>
                <p><strong>Client Reply-to:</strong> ${
                  emailThread?.replyToAddress || "Not available"
                }</p>
              </div>
            </div>
            
            <div class="footer">
              <p><small>This document was regenerated by Levitate Studios AI Agent based on client feedback analysis.</small></p>
              <p><small>The AI detected client intent with ${Math.round(
                (intentResult.confidence || 0) * 100
              )}% confidence and implemented the requested changes.</small></p>
            </div>
          </div>
        </body>
        </html>
      `;

      logger.debug({
        message: "Generated brand origin regeneration notification template",
        projectId: project?.id,
        documentId: documentResult?.documentId,
        feedbackEmailId: feedbackContext?.emailId,
        intentConfidence: intentResult.confidence,
        changesCount: requestedChanges.length,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message:
          "Failed to generate brand origin regeneration notification template",
        error: error.message,
        projectId: project?.id,
        documentId: documentResult?.documentId,
        feedbackEmailId: feedbackContext?.emailId,
      });
      throw error;
    }
  }

  /**
   * Generate document acceptance confirmation template
   * @param {Object} document - Document data
   * @param {Object} project - Project data
   * @param {string} documentType - Type of document
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateDocumentAcceptanceTemplate(document, project, documentType) {
    try {
      const documentTypeName =
        documentType === "brand_origin" ? "Brand Origin" : "Budget/Timeline";
      const nextAction =
        documentType === "brand_origin"
          ? "create Budget/Timeline document"
          : "initialize project";

      const subject = `Confirm ${documentTypeName} Document Acceptance: ${project.name}`;

      const htmlContent = `
        <h2>${documentTypeName} Document Accepted by Client</h2>
        
        <h3>Project Details</h3>
        <ul>
          <li><strong>Project:</strong> ${project.name}</li>
          <li><strong>Client:</strong> ${project.client?.name || "N/A"}</li>
          <li><strong>Document Type:</strong> ${documentTypeName}</li>
          <li><strong>Status:</strong> Accepted by Client</li>
        </ul>
        
        <h3>Confirmation Required</h3>
        <p>The client has accepted the ${documentTypeName.toLowerCase()} document. Please confirm to proceed with the next phase.</p>
        
        <p>
          <a href="#" 
             style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Confirm & ${
              nextAction === "create Budget/Timeline document"
                ? "Create Budget/Timeline"
                : "Initialize Project"
            } →
          </a>
        </p>
        
        <p><strong>Note:</strong> Either PM or Finance Manager can confirm. Only one confirmation is needed.</p>
        
        <hr>
        <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
      `;

      logger.debug({
        message: "Generated document acceptance template",
        documentId: document.id,
        projectId: project.id,
        documentType,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate document acceptance template",
        error: error.message,
        documentId: document?.id,
        projectId: project?.id,
        documentType,
      });
      throw error;
    }
  }

  /**
   * Generate generic multi-recipient notification template
   * @param {string} subject - Email subject
   * @param {string} content - Main content body
   * @param {Object} additionalData - Additional data to include in template
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateGenericTemplate(subject, content, additionalData = {}) {
    try {
      const htmlContent = `
        <h2>${subject}</h2>
        
        <div>
          ${content}
        </div>
        
        ${
          additionalData.projectDetails
            ? `
        <h3>Project Details</h3>
        <ul>
          ${Object.entries(additionalData.projectDetails)
            .map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`)
            .join("")}
        </ul>
        `
            : ""
        }
        
        ${
          additionalData.actionButtons
            ? `
        <h3>Actions</h3>
        <p>
          ${additionalData.actionButtons
            .map(
              (button) =>
                `<a href="${button.url || "#"}" 
               style="background-color: ${
                 button.color || "#007bff"
               }; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px;">
              ${button.text} →
            </a>`
            )
            .join("")}
        </p>
        `
            : ""
        }
        
        <hr>
        <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
      `;

      logger.debug({
        message: "Generated generic email template",
        subject,
        hasAdditionalData: !!Object.keys(additionalData).length,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate generic email template",
        error: error.message,
        subject,
      });
      throw error;
    }
  }

  /**
   * Validate template data before generation
   * @param {Object} data - Template data to validate
   * @param {Array<string>} requiredFields - Required fields for the template
   * @returns {boolean} True if validation passes
   * @throws {Error} If validation fails
   */
  static validateTemplateData(data, requiredFields = []) {
    for (const field of requiredFields) {
      if (!data[field]) {
        throw new Error(`Missing required template data: ${field}`);
      }
    }
    return true;
  }

  /**
   * Generate client document email template with PDF attachment
   * @param {Object} project - Project data
   * @param {Object} document - Document data
   * @param {Object} pdfFile - PDF file information
   * @param {Object} emailThread - Email thread data
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateClientDocumentEmailTemplate(
    project,
    document,
    pdfFile,
    emailThread
  ) {
    try {
      const documentTypeName =
        document.type === "BRAND_ORIGIN" ? "Brand Origin" : "Budget/Timeline";
      const subject = `${documentTypeName} Document - ${project.name}`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e1e5e9; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
            .highlight { background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin: 20px 0; }
            .important { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 20px 0; }
            .icon { font-size: 24px; margin-right: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1><span class="icon">📄</span>${documentTypeName} Document</h1>
              <p>Your ${documentTypeName.toLowerCase()} document is ready for review</p>
            </div>
            
            <div class="content">
              <p>Dear ${project.client?.name || "Valued Client"},</p>
              
              <p>We're excited to share your <strong>${documentTypeName}</strong> document for the <strong>${
        project.name
      }</strong> project.</p>
              
              <div class="highlight">
                <h3><span class="icon">📋</span>Document Details</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Project:</strong> ${project.name}</li>
                  <li><strong>Document Type:</strong> ${documentTypeName}</li>
                  <li><strong>Created:</strong> ${new Date().toLocaleDateString(
                    "en-NG",
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }
                  )}</li>
                  <li><strong>Format:</strong> PDF Attachment</li>
                </ul>
              </div>

              <p>Please review the attached document carefully. If you have any feedback, questions, or requested changes, simply reply to this email with your comments.</p>

              <div style="text-align: center; margin: 20px 0;">
                <a href="${pdfFile.webViewLink}" 
                   style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: 600;"
                   target="_blank">
                  📄 View PDF Document
                </a>
              </div>

              <div class="important">
                <p style="margin: 0;"><strong>📧 Important - Reply Instructions:</strong></p>
                <p style="margin: 10px 0;">When replying to this email or any email conversation, please ensure your message includes the following email address in the "To" or "CC" field:</p>
                <p style="margin: 10px 0; font-family: monospace; background: #f8f9fa; padding: 8px; border-radius: 4px;"><strong>${
                  emailThread.replyToAddress
                }</strong></p>
                <p style="margin: 10px 0;">This ensures your feedback reaches our team promptly and is properly tracked with your project.</p>
              </div>

              <h3>Next Steps:</h3>
              <ol>
                <li><strong>Review</strong> the attached PDF document</li>
                <li><strong>Provide feedback</strong> by replying to this email if changes are needed</li>
                <li><strong>Approve</strong> by replying with your approval if the document meets your expectations</li>
              </ol>

              <p>Our team will respond to your feedback promptly and make any necessary revisions. Once approved, we'll proceed to the next phase of your project.</p>

              <p>Thank you for choosing Levitate Studios. We're committed to delivering exceptional results for your brand.</p>
            </div>
            
            <div class="footer">
              <p style="margin: 0; color: #6c757d; font-size: 14px;">
                <strong>Levitate Studios</strong><br>
                Professional Brand Development & Design Services<br>
                Reply to this email for any questions or feedback
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      logger.debug({
        message: "Generated client document email template",
        projectId: project.id,
        documentId: document.id,
        clientName: project.client?.name,
        documentType: document.type,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate client document email template",
        error: error.message,
        projectId: project?.id,
        documentId: document?.id,
      });
      throw error;
    }
  }

  /**
   * Generate action feedback email template for successful actions
   * @param {Object} params - Feedback parameters
   * @param {string} params.to - Recipient email
   * @param {string} params.userName - User name
   * @param {string} params.action - Action performed
   * @param {string} params.projectName - Project name
   * @param {string} params.clientName - Client name
   * @param {string} params.documentType - Document type
   * @param {string} params.correlationId - Correlation ID
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateActionSuccessFeedbackTemplate({
    to,
    userName,
    action,
    projectName,
    clientName,
    documentType,
    correlationId,
  }) {
    try {
      const subject = `✅ Action Completed: ${action}`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #28a745; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: white; padding: 20px; border: 1px solid #e1e5e9; border-top: none; }
            .footer { background: #f8f9fa; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
            .success-box { background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 15px; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>✅ Action Completed Successfully</h2>
            </div>
            
            <div class="content">
              <p>Hi ${userName},</p>
              
              <div class="success-box">
                <p style="margin: 0;"><strong>Action:</strong> ${action}</p>
                <p style="margin: 5px 0 0 0;"><strong>Status:</strong> Completed Successfully</p>
              </div>

              <h3>Project Details:</h3>
              <ul>
                <li><strong>Project:</strong> ${projectName}</li>
                <li><strong>Client:</strong> ${clientName}</li>
                <li><strong>Document Type:</strong> ${documentType}</li>
                <li><strong>Completed:</strong> ${new Date().toLocaleDateString(
                  "en-NG",
                  {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }
                )}</li>
              </ul>

              <p><strong>Next Steps:</strong> The client will receive the document and can reply with feedback or acceptance. Admin (${
                appConfig.server.adminEmail
              }) be notified of any client responses.</p>

              <p>Thank you for using the Levitate Studios AI Agent system.</p>
            </div>
            
            <div class="footer">
              <p style="margin: 0; color: #6c757d; font-size: 12px;">
                Correlation ID: ${correlationId}<br>
                This is an automated confirmation from Levitate Studios AI Agent
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate action success feedback template",
        error: error.message,
        to,
        userName,
        action,
      });
      throw error;
    }
  }

  /**
   * Generate action error feedback email template
   * @param {Object} params - Error feedback parameters
   * @param {string} params.to - Recipient email
   * @param {string} params.userName - User name
   * @param {string} params.action - Action that failed
   * @param {string} params.error - Error message
   * @param {string} params.correlationId - Correlation ID
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateActionErrorFeedbackTemplate({
    to,
    userName,
    action,
    error,
    correlationId,
  }) {
    try {
      const subject = `❌ Action Failed: ${action}`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: white; padding: 20px; border: 1px solid #e1e5e9; border-top: none; }
            .footer { background: #f8f9fa; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
            .error-box { background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 15px; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>❌ Action Failed</h2>
            </div>
            
            <div class="content">
              <p>Hi ${userName},</p>
              
              <p>There was an error performing the requested action:</p>

              <div class="error-box">
                <p style="margin: 0;"><strong>Action:</strong> ${action}</p>
                <p style="margin: 5px 0 0 0;"><strong>Error:</strong> ${error}</p>
              </div>

              <p><strong>What to do next:</strong></p>
              <ul>
                <li>Try the action again using a new link (if available)</li>
                <li>Contact support if the issue persists</li>
                <!-- <li>Check the admin panel for alternative options</li> -->
              </ul>

              <p>If you continue to experience issues, please contact our support team with the correlation ID below.</p>
            </div>
            
            <div class="footer">
              <p style="margin: 0; color: #6c757d; font-size: 12px;">
                Correlation ID: ${correlationId}<br>
                This is an automated error notification from Levitate Studios AI Agent
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate action error feedback template",
        error: error.message,
        to,
        userName,
        action,
      });
      throw error;
    }
  }

  /**
   * Generate new send link email template
   * @param {Object} params - New link parameters
   * @param {string} params.to - Recipient email
   * @param {string} params.userName - User name
   * @param {string} params.projectName - Project name
   * @param {string} params.documentType - Document type
   * @param {string} params.sendToClientUrl - New send to client URL
   * @param {string} params.correlationId - Correlation ID
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateNewSendLinkTemplate({
    to,
    userName,
    projectName,
    documentType,
    sendToClientUrl,
    correlationId,
  }) {
    try {
      const subject = `🔗 New Send Link Generated: ${projectName}`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #17a2b8; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: white; padding: 20px; border: 1px solid #e1e5e9; border-top: none; }
            .footer { background: #f8f9fa; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
            .btn { display: inline-block; padding: 12px 24px; margin: 10px 0; text-decoration: none; border-radius: 5px; font-weight: 600; text-align: center; background-color: #007bff; color: white; }
            .btn:hover { opacity: 0.9; }
            .link-box { background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 8px; padding: 15px; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>🔗 New Send Link Generated</h2>
            </div>
            
            <div class="content">
              <p>Hi ${userName},</p>
              
              <p>A new send-to-client link has been generated for your request:</p>

              <div class="link-box">
                <p style="margin: 0;"><strong>Project:</strong> ${projectName}</p>
                <p style="margin: 5px 0;"><strong>Document:</strong> ${documentType}</p>
                <p style="margin: 5px 0 0 0;"><strong>Generated:</strong> ${new Date().toLocaleDateString(
                  "en-NG",
                  {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }
                )}</p>
              </div>

              <div style="text-align: center; margin: 20px 0;">
                <a href="${sendToClientUrl}" class="btn" style="color: white;">
                  📧 Send to Client
                </a>
              </div>

              <p><strong>Important Notes:</strong></p>
              <ul>
                <li>This link is valid for 24 hours</li>
                <li>The link can only be used once</li>
                <li>Clicking the link will convert the document to PDF and email it to the client</li>
                <li>You'll receive a confirmation email once the action is completed</li>
              </ul>

              <p>Thank you for using the Levitate Studios AI Agent system.</p>
            </div>
            
            <div class="footer">
              <p style="margin: 0; color: #6c757d; font-size: 12px;">
                Correlation ID: ${correlationId}<br>
                This link was generated at your request from Levitate Studios AI Agent
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate new send link template",
        error: error.message,
        to,
        userName,
        projectName,
      });
      throw error;
    }
  }

  /**
   * Generate admin notification email template for new client email
   * @param {Object} project - Project object with client info
   * @param {Object} brevoItem - Brevo email item
   * @param {Object} emailRecord - Email database record
   * @param {Array} attachmentLinks - Array of Google Drive attachment links
   * @param {Array} conversationHistory - Array of previous emails in the conversation for context
   * @returns {Object} Email template
   */
  static generateAdminInboundEmailNotificationTemplate(
    project,
    brevoItem,
    emailRecord,
    attachmentLinks = [],
    conversationHistory = []
  ) {
    const emailContent =
      brevoItem.ExtractedMarkdownMessage || brevoItem.RawTextBody || "";

    const subject = `New Client Email: ${project.client.name} - ${project.name}`;

    const attachmentsHtml =
      attachmentLinks && attachmentLinks.length > 0
        ? `
    <div style="margin-bottom: 20px;">
      <h2 style="color: #0a0a0a; font-size: 18px; margin-bottom: 10px;">Attachments:</h2>
      <ul style="list-style: none; padding: 0;">
        ${attachmentLinks
          .map(
            (att) => `
        <li style="background-color: #f8f9fa; padding: 10px; margin-bottom: 5px; border-radius: 5px;">
          📎 <a href="${
            att.webViewLink
          }" target="_blank" style="color: #0a0a0a; text-decoration: none;">${
              att.name
            }</a> (${Math.round(att.size / 1024)} KB)
        </li>
        `
          )
          .join("")}
      </ul>
    </div>
    `
        : brevoItem.Attachments && brevoItem.Attachments.length > 0
        ? `
    <div style="margin-bottom: 20px;">
      <h2 style="color: #0a0a0a; font-size: 18px; margin-bottom: 10px;">Attachments:</h2>
      <ul style="list-style: none; padding: 0;">
        ${brevoItem.Attachments.map(
          (att) => `
        <li style="background-color: #f8f9fa; padding: 10px; margin-bottom: 5px; border-radius: 5px;">
          📎 ${att.Name} (${Math.round(att.ContentLength / 1024)} KB)
        </li>
        `
        ).join("")}
      </ul>
    </div>
    `
        : "";

    // Helper function to escape HTML to prevent XSS
    const escapeHtml = (text) => {
      if (!text || typeof text !== "string") return text;
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
    };

    // Generate conversation history HTML
    const conversationHistoryHtml =
      conversationHistory && conversationHistory.length > 0
        ? `
    <div style="margin-bottom: 20px;">
      <h2 style="color: #0a0a0a; font-size: 18px; margin-bottom: 10px;">📋 Recent Conversation History (${
        conversationHistory.length
      } previous emails):</h2>
      <div style="background-color: #f8f9fa; border-radius: 5px; padding: 15px; max-height: 400px; overflow-y: auto;">
        ${conversationHistory
          .map((email, index) => {
            const emailDate = new Date(email.receivedAt).toLocaleDateString(
              "en-NG",
              {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }
            );

            const directionIcon = email.direction === "OUTBOUND" ? "📤" : "📥";
            const directionColor =
              email.direction === "OUTBOUND" ? "#28a745" : "#007bff";

            // Truncate long email content for readability and handle null/undefined safely
            const truncatedContent =
              email.textBody &&
              typeof email.textBody === "string" &&
              email.textBody.trim().length > 0
                ? email.textBody.length > 200
                  ? email.textBody.substring(0, 200) + "..."
                  : email.textBody
                : "(no content)";

            return `
        <div style="border-left: 3px solid ${directionColor}; padding-left: 10px; margin-bottom: 15px; ${
              index === conversationHistory.length - 1
                ? "margin-bottom: 0;"
                : ""
            }">
          <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <span style="margin-right: 8px;">${directionIcon}</span>
            <strong style="color: ${directionColor}; margin-right: 10px;">${
              email.direction
            }</strong>
            <span style="font-size: 12px; color: #666; margin-right: 10px;">${emailDate}</span>
            ${
              email.intent && email.intent !== "NONE"
                ? `<span style="background-color: #e9ecef; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #495057;">Intent: ${escapeHtml(
                    email.intent
                  )}</span>`
                : ""
            }
          </div>
          <div style="font-size: 13px; color: #495057; margin-bottom: 3px;">
            <strong>From:</strong> ${
              escapeHtml(email.fromAddr) || "(unknown sender)"
            }
          </div>
          <div style="font-size: 13px; color: #495057; margin-bottom: 8px;">
            <strong>Subject:</strong> ${escapeHtml(
              email.subject && email.subject.trim()
                ? email.subject
                : "(no subject)"
            )}
          </div>
          <div style="font-size: 12px; color: #6c757d; font-family: 'Courier New', monospace; white-space: pre-wrap; background-color: #ffffff; padding: 8px; border-radius: 3px; border: 1px solid #dee2e6;">${escapeHtml(
            truncatedContent
          )}</div>
        </div>
              `;
          })
          .join("")}
      </div>
    </div>
    `
        : "";

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>New Client Email</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f4f4f4; color: #333333; margin: 0; padding: 20px; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <h1 style="color: #0a0a0a; margin-bottom: 20px; font-size: 24px;">📧 New Client Email Received</h1>
    
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
      <p style="margin: 5px 0;"><strong>Client:</strong> ${
        project.client.name
      }</p>
      <p style="margin: 5px 0;"><strong>Project:</strong> ${project.name}</p>
      <p style="margin: 5px 0;"><strong>From:</strong> ${
        brevoItem.From.Address
      }</p>
      <p style="margin: 5px 0;"><strong>Subject:</strong> ${
        brevoItem.Subject || "(no subject)"
      }</p>
      <p style="margin: 5px 0;"><strong>Received:</strong> ${new Date(
        brevoItem.SentAtDate || Date.now()
      ).toLocaleDateString("en-NG", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}</p>
    </div>

    <div style="margin-bottom: 20px;">
      <h2 style="color: #0a0a0a; font-size: 18px; margin-bottom: 10px;">📧 Current Message Content:</h2>
      <div style="background-color: #ffffff; border-left: 4px solid #0a0a0a; padding: 15px; white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 14px;">${emailContent}</div>
    </div>
    
    ${attachmentsHtml}

    ${conversationHistoryHtml}

    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin-top: 20px;">
      <p style="margin: 0; font-size: 14px;">
        <strong>ℹ️ Note:</strong> Levitate AI Agent is analyzing this email to detect intent and determine appropriate actions. 
        You will be notified of any actions taken.
      </p>
    </div>

    <div style="text-align: center; margin-top: 30px; font-size: 12px; color: #666666;">
      <p>&copy; ${new Date().getFullYear()} Levitate Studios. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    return {
      subject,
      htmlContent,
      textContent: `New Client Email from ${project.client.name}\n\n${emailContent}`,
    };
  }

  /**
   * Generate document regeneration failure notification template
   * @param {Object} project - Project data
   * @param {Object} currentDocument - Current document data
   * @param {Object} email - Email data
   * @param {Object} intentResult - Intent detection result
   * @param {Error} error - The error that occurred
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateDocumentRegenerationFailureTemplate(
    project,
    currentDocument,
    email,
    intentResult,
    error,
    correlationId
  ) {
    try {
      const subject = `🚨 Document Regeneration Failed - ${
        project.client?.name || "Client"
      } - ${project.name}`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #dc3545; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e1e5e9; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
            .error-box { background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 15px; margin: 20px 0; }
            .project-info { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .action-required { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚨 Document Regeneration Failed</h1>
              <p>Automatic regeneration failed after 3 retry attempts</p>
            </div>
            
            <div class="content">
              <div class="project-info">
                <h3>📋 Project Details</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Client:</strong> ${
                    project.client?.name || "Unknown Client"
                  }</li>
                  <li><strong>Project:</strong> ${project.name}</li>
                  <li><strong>Document Type:</strong> ${
                    currentDocument.type
                  }</li>
                  <li><strong>Document ID:</strong> ${currentDocument.id}</li>
                  <li><strong>Client Email ID:</strong> ${email.id}</li>
                  <li><strong>Failed At:</strong> ${new Date().toLocaleDateString(
                    "en-NG",
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }
                  )}</li>
                </ul>
              </div>

              <div class="error-box">
                <h3>❌ Error Details</h3>
                <p><strong>Error Message:</strong> ${error.message}</p>
                <p><strong>Correlation ID:</strong> ${correlationId}</p>
                <p><strong>Client Feedback Summary:</strong> ${
                  intentResult.summary || "No summary available"
                }</p>
              </div>

              <div class="action-required">
                <h3>⚠️ Action Required</h3>
                <p><strong>Manual intervention is required to regenerate the document.</strong></p>
                
                <h4>Options:</h4>
                <ol>
                  <li><strong>Retry via UI:</strong> Use the admin panel to manually trigger document regeneration</li>
                  <li><strong>Contact Developer:</strong> If the issue persists, contact the development team with the correlation ID above</li>
                  <li><strong>Manual Process:</strong> Handle the client feedback manually by editing the document directly</li>
                </ol>
              </div>

              <div style="background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h4>📧 Client Feedback Context</h4>
                <p><strong>From:</strong> ${email.from}</p>
                <p><strong>Subject:</strong> ${
                  email.subject || "(no subject)"
                }</p>
                <p><strong>Intent Confidence:</strong> ${Math.round(
                  (intentResult.confidence || 0) * 100
                )}%</p>
                <p><strong>Requested Changes:</strong> ${
                  intentResult.requestedChanges?.length || 0
                } changes detected</p>
              </div>
            </div>
            
            <div class="footer">
              <p><small>This is an automated error notification from Levitate Studios AI Agent.</small></p>
              <p><small>The document status has been updated to CLIENT_FEEDBACK for manual handling.</small></p>
            </div>
          </div>
        </body>
        </html>
      `;

      logger.debug({
        message: "Generated document regeneration failure template",
        projectId: project?.id,
        documentId: currentDocument?.id,
        emailId: email?.id,
        correlationId,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate document regeneration failure template",
        error: error.message,
        projectId: project?.id,
        documentId: currentDocument?.id,
        emailId: email?.id,
        correlationId,
      });
      throw error;
    }
  }

  /**
   * Sanitize template content to prevent XSS
   * @param {string} content - Content to sanitize
   * @returns {string} Sanitized content
   */
  static sanitizeContent(content) {
    if (!content || typeof content !== "string") {
      return "";
    }

    // Basic HTML sanitization - remove script tags and dangerous attributes
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+="[^"]*"/gi, "")
      .replace(/javascript:/gi, "")
      .trim();
  }
}

module.exports = { EmailTemplateService };
