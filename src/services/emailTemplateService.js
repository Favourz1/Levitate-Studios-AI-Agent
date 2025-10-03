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
      const { appConfig } = require("@/config");

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
          <li><strong>Initialized:</strong> ${new Date().toISOString()}</li>
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
          <li><strong>Created:</strong> ${new Date().toISOString()}</li>
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
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateBrandOriginNotificationTemplate(
    project,
    documentResult,
    emailThread
  ) {
    try {
      const { appConfig } = require("@/config");
      const subject = `Brand Origin Document Ready: ${
        project.client?.name || project.name
      }`;

      // Generate action URLs for Review and Send to Client
      const reviewUrl = `${
        appConfig.server.frontendUrl || "https://admin.levitate.ng"
      }/admin/documents/${documentResult.documentId}/review`;
      const sendToClientUrl = `${
        appConfig.server.frontendUrl || "https://admin.levitate.ng"
      }/admin/documents/${documentResult.documentId}/send-to-client`;

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
                  <li><strong>Created:</strong> ${new Date().toLocaleString()}</li>
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
                <a href="${
                  documentResult.webViewLink
                }" class="btn btn-success" target="_blank" style="color: white;">
                  <span class="icon">📄</span>Review Document
                </a>
                <a href="${sendToClientUrl}" class="btn btn-primary" style="color: white;">
                  <span class="icon">📧</span>Send to Client
                </a>
              </div>

              <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <p style="margin: 0;"><strong>💡 Quick Actions:</strong></p>
                <ul style="margin: 10px 0;">
                  <li><strong>Google Doc:</strong> <a href="${
                    documentResult.webViewLink
                  }" target="_blank">Open in Google Docs</a></li>
                  <!-- <li><strong>Admin Panel:</strong> <a href="${reviewUrl}" target="_blank">Review in Admin</a></li> -->
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
