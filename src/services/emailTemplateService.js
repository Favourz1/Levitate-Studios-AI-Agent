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
  static generatePMNotificationTemplate(client, project, emailThread) {
    try {
      // TODO: Move to an email template file for email templates
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
        <p>A new questionnaire has been submitted and is ready for review. The system will automatically generate a brand origin document and inform you also.</p>
        
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
