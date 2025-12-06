const { appConfig } = require("@/config");
const { DocumentType } = require("@/constants");
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
   * Generate project initialization completion notification template
   * For Admin, Manager (if any), and PM
   * @param {Object} project - Project data with asanaProjectGid
   * @param {string} asanaProjectUrl - Asana project URL
   * @param {Array} projectDocuments - Array of project documents with Drive links (optional)
   * @param {boolean} includeFinancials - Whether to include financial information (quote links) (default: true)
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateProjectInitializationCompleteTemplate(
    project,
    asanaProjectUrl,
    projectDocuments = [],
    includeFinancials = true
  ) {
    try {
      const subject = `Project Initialized: ${project.name}`;
      const asanaLink = asanaProjectUrl
        ? `<p><a href="${asanaProjectUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Asana Project →</a></p>`
        : "";

      // Filter documents based on includeFinancials flag
      // Workplan documents are visible to both admin/manager and PM (no restrictions)
      const documentsToShow = includeFinancials
        ? projectDocuments
        : projectDocuments.filter(
            (doc) =>
              doc.type !== DocumentType.QUOTE &&
              doc.type !== DocumentType.QUOTE_VARIANT
          );

      // Generate document links section
      let documentLinksHtml = "";
      if (documentsToShow && documentsToShow.length > 0) {
        const documentItems = documentsToShow
          .map((doc) => {
            const docTypeName =
              doc.type === DocumentType.BRAND_ORIGIN
                ? "Brand Origin Document"
                : doc.type === DocumentType.QUOTE
                ? "Quote Document"
                : doc.type === DocumentType.QUOTE_VARIANT
                ? "Quote Variant"
                : doc.type === DocumentType.WORKPLAN
                ? "Workplan Document"
                : "Document";

            if (doc.driveLink) {
              return `<li><strong>${docTypeName}:</strong> <a href="${doc.driveLink}" target="_blank" style="color: #007bff; text-decoration: none;">View Document</a></li>`;
            }
            return `<li><strong>${docTypeName}:</strong> Available (link not available)</li>`;
          })
          .join("");

        documentLinksHtml = `
          <h3>📄 Project Documents</h3>
          <ul>
            ${documentItems}
          </ul>
        `;
      }

      const htmlContent = `
        <h2>Project Initialized Successfully</h2>
        
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
        
        <h3>What's Been Done</h3>
        <ul>
          <li>Asana project created with board layout</li>
          <li>Sections created: "To Do", "In Progress", "In Review", "Completed"</li>
          <li>Team members selected and added to the project</li>
          <li>Project description generated and added</li>
        </ul>
        
        ${documentLinksHtml}
        
        <h3>Next Steps</h3>
        <p>The project is now ready for task assignment. Team members have been added to the Asana project and can start working on tasks.</p>
        
        ${asanaLink}
        
        <p><strong>Note:</strong> No tasks have been created or assigned yet. You can now proceed with task creation and assignment as needed.</p>
        
        <hr>
        <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
      `;

      logger.debug({
        message: "Generated project initialization complete template",
        projectId: project.id,
        includeFinancials,
        documentsCount: documentsToShow.length,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate project initialization complete template",
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
   * @param {string} documentType - Type of document (brand_origin, quote)
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateDocumentReviewTemplate(document, project, documentType) {
    try {
      const documentTypeName =
        documentType === "brand_origin" ? "Brand Origin" : "Quote";
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
        ? `${appConfig.server.baseUrl}/api/v1/actions/review?t=${actionTokens.generateLinkToken}`
        : "#";

      const sendToClientUrl = actionTokens.sendToClientToken
        ? `${appConfig.server.baseUrl}/api/v1/actions/send-to-client?t=${actionTokens.sendToClientToken}`
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
   * Generate quote document notification template for Finance/Admin
   * @param {Object} project
   * @param {Object} details
   * @returns {{subject: string, htmlContent: string}}
   */
  /**
   * Generate quote document notification template for Finance/Admin with direct Send to Client buttons
   * This template allows users to select and send any quote variant directly to client
   * @param {Object} project - Project data
   * @param {Object} details - Quote details including action tokens
   * @param {string} details.mainQuoteId - Main quote ID
   * @param {Array} details.variantQuoteIds - Array of variant quote IDs
   * @param {Array} details.driveFiles - Array of Drive file objects
   * @param {Object} details.sendToClientTokens - Tokens for send buttons {quoteId: token}
   * @returns {{subject: string, htmlContent: string}}
   */
  static generateQuoteNotificationTemplate(project, details = {}) {
    try {
      const subject = `Quote Document Ready - Select & Send to Client: ${project.name}`;
      const driveFiles = Array.isArray(details.driveFiles)
        ? details.driveFiles.filter((file) => !!file)
        : [];
      const mainDriveFile = driveFiles.find(
        (file) => file.quoteId === details.mainQuoteId
      );
      const variantFiles = driveFiles.filter(
        (file) => file.quoteId !== details.mainQuoteId
      );
      const sendToClientTokens = details.sendToClientTokens || {};

      // Generate main quote button with send action
      const mainQuoteButton = mainDriveFile
        ? `
          <div style="margin: 16px 0; padding: 16px; background: #e3f2fd; border-left: 4px solid #0f62fe; border-radius: 4px;">
            <div style="margin-bottom: 12px;">
              <strong>Main Quote (${details.mainQuoteId})</strong><br/>
              <small>Recommended based on project requirements</small>
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <a href="${mainDriveFile.webViewLink || "#"}" 
                 target="_blank" 
                 rel="noopener noreferrer"
                 style="display: inline-block; padding: 10px 16px; background: #666; color: white; text-decoration: none; border-radius: 4px; font-size: 14px; margin-right:14px;">
                 View PDF
              </a>
              ${
                sendToClientTokens[details.mainQuoteId]
                  ? `
                <a href="${
                  appConfig.server.baseUrl
                }/api/v1/actions/send-to-client?t=${
                      sendToClientTokens[details.mainQuoteId]
                    }&quoteId=${details.mainQuoteId}"
                   style="display: inline-block; padding: 10px 16px; background: #0f62fe; color: white; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 14px;">
                  📤 Send to Client
                </a>
              `
                  : ""
              }
            </div>
          </div>
        `
        : "";

      // Generate variant quote buttons
      const variantButtons = variantFiles
        .map((file, index) => {
          const sendToken = sendToClientTokens[file.quoteId];
          return `
          <div style="margin: 16px 0; padding: 16px; background: #f5f5f5; border-radius: 4px;">
            <div style="margin-bottom: 12px;">
              <strong>Variant ${index + 1} (${file.quoteId})</strong><br/>
              <small>Alternative pricing/scope configuration</small>
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <a href="${file.webViewLink || "#"}" 
                 target="_blank" 
                 rel="noopener noreferrer"
                 style="display: inline-block; padding: 10px 16px; background: #666; color: white; text-decoration: none; border-radius: 4px; font-size: 14px; margin-right:14px;">
                 View PDF
              </a>
              ${
                sendToken
                  ? `
                <a href="${appConfig.server.baseUrl}/api/v1/actions/send-to-client?t=${sendToken}&quoteId=${file.quoteId}"
                   style="display: inline-block; padding: 10px 16px; background: #28a745; color: white; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 14px;">
                  📤 Send to Client
                </a>
              `
                  : ""
              }
            </div>
          </div>
          `;
        })
        .join("");

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 700px; margin: 0 auto; padding: 24px; background: #ffffff; }
            .header { background: linear-gradient(135deg, #0f62fe 0%, #0353e9 100%); color: white; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center; }
            .header h2 { margin: 0 0 8px 0; font-size: 28px; }
            .header p { margin: 0; font-size: 16px; opacity: 0.95; }
            .content { padding: 32px 24px; background: #fafbfc; border: 1px solid #e1e5e9; border-top: none; }
            .project-info { background: white; padding: 16px; border-radius: 8px; margin-bottom: 24px; border-left: 4px solid #0f62fe; }
            .project-info p { margin: 8px 0; }
            .quotes-section { margin-top: 24px; }
            .quotes-section h3 { margin-top: 0; margin-bottom: 16px; color: #0f62fe; }
            .footer { background: #f0f2f5; padding: 24px; border-radius: 0 0 12px 12px; text-align: center; font-size: 14px; color: #666; }
            .footer a { color: #0f62fe; text-decoration: none; }
            .instructions { background: #fff3cd; border-left: 4px solid #ffc107; padding: 16px; border-radius: 4px; margin-top: 24px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>💼 Quote Package Ready</h2>
              <p>Ready to send to client</p>
            </div>
            
            <div class="content">
              <div class="project-info">
                <p><strong>Project:</strong> ${project.name}</p>
                <p><strong>Client:</strong> ${project.client?.name || "N/A"}</p>
                <p><strong>Created:</strong> ${new Date().toLocaleDateString(
                  "en-NG",
                  {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }
                )}</p>
                <p><strong>Total Items in Main Quote:</strong> ${
                  details.totalItems || "N/A"
                }</p>
              </div>

              <div class="quotes-section">
                <h3>📋 Available Quotes</h3>
                <p>Below are all generated quote variations. Select and send the preferred option to the client by clicking the "📤 Send to Client" button.</p>
                
                ${mainQuoteButton}
                
                ${
                  variantFiles.length > 0
                    ? `<div style="margin-top: 24px; padding-top: 24px; border-top: 2px solid #e1e5e9;"><h4 style="margin-top: 0;">Alternative Variations:</h4>${variantButtons}</div>`
                    : ""
                }
              </div>

              <div class="instructions">
                <strong>⚠️ Important:</strong>
                <ul style="margin: 8px 0; padding-left: 20px;">
                  <li>Click "View PDF" to review any quote before sending</li>
                  <li>If you want to make changes to any quote, copy the quote ID and edit in the ERP Software - <b>It's important to leave the quote in "Draft" stage and come back here to click send to client of the quote edited.</b></li>
                  <li>Click "Send to Client" to send the selected quote to the client</li>
                  <li>The quote will be automatically tracked and client feedback will be monitored</li>
                  <li>You can send any variant - once sent, that becomes the active quote for feedback</li>
                </ul>
              </div>

              <p style="margin-top: 24px; color: #666; font-size: 14px;">
                <strong>Note:</strong> Each quote variant represents different pricing/scope strategies. Review all options and select the best fit for your client.
              </p>
            </div>

            <div class="footer">
              <p style="margin: 0;">Quote managed by Levitate Studios AI Agent<br/>
              <a href="${appConfig.server.baseUrl}">View in Dashboard</a></p>
            </div>
          </div>
        </body>
        </html>
      `;

      logger.debug({
        message: "Generated quote notification template with send buttons",
        projectId: project?.id,
        mainQuoteId: details.mainQuoteId,
        variantCount: variantFiles.length,
        tokensCount: Object.keys(sendToClientTokens).length,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate quote notification template",
        error: error.message,
        projectId: project?.id,
      });
      throw error;
    }
  }

  /**
   * Generate quote update notification template for Finance Manager
   * Notifies when a quote has been updated based on client feedback
   * @param {Object} project - Project data
   * @param {Object} details - Quote update details
   * @param {string} details.quoteId - Updated quote ID
   * @param {string} details.previousQuoteId - Previous quote ID (if amended)
   * @param {boolean} details.wasAmended - Whether quote was amended (cancelled and recreated)
   * @param {Object} details.driveFile - Google Drive file object for updated PDF
   * @param {string} details.feedbackSummary - Summary of client feedback
   * @param {Array} details.requestedChanges - Array of requested changes
   * @returns {{subject: string, htmlContent: string}}
   */
  static generateQuoteUpdateNotificationTemplate(project, details = {}) {
    try {
      const subject = `Quote Updated Based on Client Feedback: ${project.name}`;
      const {
        quoteId,
        previousQuoteId,
        wasAmended,
        driveFile,
        feedbackSummary,
        requestedChanges = [],
        sendToClientToken,
      } = details;

      const changesList =
        requestedChanges.length > 0
          ? requestedChanges
              .map(
                (change, idx) =>
                  `<li><strong>${change.section || "General"}:</strong> ${
                    change.change
                  } ${
                    change.priority ? `(Priority: ${change.priority})` : ""
                  }</li>`
              )
              .join("")
          : "<li>General feedback - please review updated quote</li>";

      const amendedNotice = wasAmended
        ? `<div style="margin: 16px 0; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
             <strong>⚠️ Note:</strong> The previous quote (${previousQuoteId}) was detected as cancelled and a new draft quote (${quoteId}) has been created with the requested changes.
           </div>`
        : "";

      const htmlContent = `
        <h2>Quote Updated Based on Client Feedback</h2>
        
        <h3>Project Details</h3>
        <ul>
          <li><strong>Project:</strong> ${project.name}</li>
          <li><strong>Client:</strong> ${project.client?.name || "N/A"}</li>
          <li><strong>Updated Quote ID:</strong> ${quoteId}</li>
          ${
            wasAmended
              ? `<li><strong>Previous Quote ID:</strong> ${previousQuoteId}</li>`
              : ""
          }
        </ul>

        ${amendedNotice}

        <h3>Client Feedback Summary</h3>
        <p>${
          feedbackSummary ||
          "Client provided feedback requesting changes to the quote."
        }</p>

        <h3>Requested Changes</h3>
        <ul>
          ${changesList}
        </ul>

        <h3>Updated Quote</h3>
        <p>The quote has been automatically updated based on the client's feedback. Please review the updated quote and send it to the client if approved.</p>

        <div style="margin: 20px 0; padding: 16px; background: #e3f2fd; border-left: 4px solid #0f62fe; border-radius: 4px;">
          <div style="margin-bottom: 12px;">
            <strong>Updated Quote (${quoteId})</strong>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${
              driveFile?.webViewLink
                ? `
              <a href="${driveFile.webViewLink}" 
                 target="_blank" 
                 rel="noopener noreferrer"
                 style="display: inline-block; padding: 10px 16px; background: #666; color: white; text-decoration: none; border-radius: 4px; font-size: 14px; margin-right: 14px;">
                 📄 View Updated PDF
              </a>
            `
                : ""
            }
            ${
              sendToClientToken
                ? `
              <a href="${appConfig.server.baseUrl}/api/v1/actions/send-to-client?t=${sendToClientToken}&quoteId=${quoteId}"
                 style="display: inline-block; padding: 10px 16px; background: #0f62fe; color: white; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 14px; margin-right: 14px;">
                 📤 Send to Client
              </a>
            `
                : ""
            }
            <a href="${appConfig.server.frontendUrl}/admin/projects/${
        project.id
      }" 
               style="display: inline-block; padding: 10px 16px; background: #666; color: white; text-decoration: none; border-radius: 4px; font-size: 14px;">
               🔧 Manage Project
            </a>
          </div>
        </div>

        <h3>Next Steps</h3>
        <ol>
          <li>Review the updated quote PDF</li>
          <li>Verify that all requested changes have been addressed</li>
          <li>If you want to make changes to the quote document, copy the quote ID and edit in the ERP Software - <b>It's important to leave the quote in "Draft" stage and come back here to click send to client of the quote edited.</b></li>
          <li>If approved, send the updated quote to the client</li>
          <li>If additional changes are needed, wait for client feedback</li>
        </ol>

        <hr>
        <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
      `;

      logger.debug({
        message: "Generated quote update notification template",
        projectId: project.id,
        quoteId,
        wasAmended,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate quote update notification template",
        error: error.message,
        projectId: project?.id,
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
        documentType === "brand_origin" ? "Brand Origin" : "Quote";
      const nextAction =
        documentType === "brand_origin"
          ? "create Quote document"
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
              nextAction === "create Quote document"
                ? "Create Quote"
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
        document.type === "BRAND_ORIGIN" ? "Brand Origin" : "Quote";
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
   * Generate rejection notification email template for PM and Admin
   * @param {Object} project - Project data
   * @param {Object} currentDocument - Current document data (if document-level rejection)
   * @param {Object} email - Email data from client
   * @param {Object} intentResult - Intent detection result
   * @param {Object} actionTokens - Action tokens for buttons
   * @param {boolean} isDocumentLevel - Whether this is a document-level or project-level rejection
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateDetectedRejectionNotificationTemplate(
    project,
    currentDocument,
    email,
    intentResult,
    actionTokens = {},
    isDocumentLevel = false
  ) {
    try {
      // Helper function to escape HTML to prevent XSS
      const escapeHtml = (text) => {
        if (!text || typeof text !== "string") return text || "";
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#x27;");
      };

      const rejectionType = isDocumentLevel ? "Document" : "Project";
      const subject = `🚨 ${rejectionType} Rejection Detected - ${escapeHtml(
        project.client?.name || "Client"
      )} - ${escapeHtml(project.name)}`;

      const confirmRejectionUrl = actionTokens.confirmRejectionToken
        ? `${appConfig.server.baseUrl}/api/v1/actions/confirm-rejection?t=${actionTokens.confirmRejectionToken}`
        : "#";

      const regenerateDocUrl = isDocumentLevel
        ? `${appConfig.server.frontendUrl}/admin/projects/${project.id}/documents/${currentDocument.id}/regenerate`
        : null;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #e1e5e9; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
            .btn { display: inline-block; padding: 12px 24px; margin: 10px 5px; text-decoration: none; border-radius: 5px; font-weight: 600; text-align: center; }
            .btn-danger { background-color: #dc3545; color: white; }
            .btn-primary { background-color: #007bff; color: white; }
            .btn:hover { opacity: 0.9; }
            .project-info { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .rejection-info { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #ffc107; }
            .intent-details { background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #dc3545; }
            .icon { font-size: 24px; margin-right: 10px; }
            .action-required { background: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196f3; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1><span class="icon">🚨</span>${rejectionType} Rejection Detected</h1>
              <p>Client has rejected the ${
                isDocumentLevel ? "document" : "project"
              }</p>
            </div>
            
            <div class="content">
              <div class="project-info">
                <h3>📋 Project Details</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Client:</strong> ${escapeHtml(
                    project.client?.name || "Unknown Client"
                  )}</li>
                  <li><strong>Project:</strong> ${escapeHtml(project.name)}</li>
                  <li><strong>Current Phase:</strong> ${escapeHtml(
                    project.phase
                  )}</li>
                  ${
                    isDocumentLevel && currentDocument
                      ? `<li><strong>Document Type:</strong> ${escapeHtml(
                          currentDocument.type
                        )}</li>
                         <li><strong>Document Status:</strong> ${escapeHtml(
                           currentDocument.status
                         )}</li>`
                      : ""
                  }
                  <li><strong>Detected At:</strong> ${new Date().toLocaleDateString(
                    "en-NG",
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }
                  )}</li>
                </ul>
              </div>

              <div class="intent-details">
                <h3>🤖 AI Intent Detection Results</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Detected Intent:</strong> REJECT</li>
                  <li><strong>Confidence Level:</strong> ${Math.round(
                    (intentResult.confidence || 0) * 100
                  )}%</li>
                  <li><strong>Summary:</strong> ${escapeHtml(
                    intentResult.summary || "No summary available"
                  )}</li>
                  <li><strong>Client Sentiment:</strong> ${escapeHtml(
                    intentResult.clientSentiment || "Not analyzed"
                  )}</li>
                  <li><strong>Urgency Level:</strong> ${escapeHtml(
                    intentResult.urgency || "Not specified"
                  )}</li>
                </ul>
              </div>

              <div class="rejection-info">
                <h3>💬 Client Rejection Details</h3>
                <p><strong>From:</strong> ${escapeHtml(
                  email.fromAddr || email.from || "Unknown"
                )}</p>
                <p><strong>Subject:</strong> ${escapeHtml(
                  email.subject || "(no subject)"
                )}</p>
                <p><strong>Received:</strong> ${new Date(
                  email.receivedAt
                ).toLocaleDateString("en-NG", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}</p>
                
                <div style="background: #ffffff; padding: 15px; border-radius: 5px; margin: 15px 0; border: 1px solid #dee2e6;">
                  <h4>Detected Client's Intent Reasoning:</h4>
                  <p style="white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 13px;">${escapeHtml(
                    intentResult.reasoning ||
                      intentResult.summary ||
                      "No reasoning provided"
                  )}</p>
                </div>

                ${
                  intentResult.requestedChanges &&
                  intentResult.requestedChanges.length > 0
                    ? `
                <div style="background: #ffffff; padding: 15px; border-radius: 5px; margin: 15px 0; border: 1px solid #dee2e6;">
                  <h4>Specific Concerns Mentioned:</h4>
                  <ol>
                    ${intentResult.requestedChanges
                      .map(
                        (change, index) =>
                          `<li><strong>${
                            change.section
                              ? `[${escapeHtml(change.section)}]`
                              : "[General]"
                          }</strong> ${escapeHtml(change.change)}</li>`
                      )
                      .join("")}
                  </ol>
                </div>
                `
                    : ""
                }
              </div>

              <div class="action-required">
                <h3>⚠️ Action Required</h3>
                <p><strong>Please review the rejection and confirm the appropriate action:</strong></p>
                
                <ol>
                  <li><strong>Review</strong> the client's feedback and reasoning above</li>
                  <li><strong>Confirm Rejection</strong> to officially mark the ${
                    isDocumentLevel ? "document" : "project"
                  } as rejected</li>
                  ${
                    isDocumentLevel
                      ? `<li><strong>Regenerate Document</strong> if you want to create a new version based on client feedback</li>`
                      : ""
                  }
                </ol>

                <div style="text-align: center; margin: 30px 0;">
                  <a href="${confirmRejectionUrl}" class="btn btn-danger" style="color: white;">
                    <span class="icon">✅</span>Confirm Rejection
                  </a>
                  ${
                    isDocumentLevel && regenerateDocUrl
                      ? `<a href="${regenerateDocUrl}" class="btn btn-primary" style="color: white;" target="_blank">
                          <span class="icon">🔄</span>Regenerate Document
                        </a>`
                      : ""
                  }
                </div>

                <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
                  <p style="margin: 0;"><strong>📝 Note:</strong> Clicking "Confirm Rejection" will:</p>
                  <ul style="margin: 10px 0;">
                    <li>Mark the ${
                      isDocumentLevel ? "document" : "project"
                    } as rejected</li>
                    ${
                      !isDocumentLevel
                        ? `<li>Update project phase to REJECTED</li>`
                        : ""
                    }
                    <li>Move Asana task to "Rejected" section</li>
                    <li>Add comment to Asana task with PM notification</li>
                    <li>Create comprehensive audit log entry</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <div class="footer">
              <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
              <p><small>The AI detected client intent with ${Math.round(
                (intentResult.confidence || 0) * 100
              )}% confidence. Please review and take appropriate action.</small></p>
            </div>
          </div>
        </body>
        </html>
      `;

      logger.debug({
        message: "Generated rejection notification template",
        projectId: project?.id,
        documentId: currentDocument?.id,
        isDocumentLevel,
        intentConfidence: intentResult.confidence,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate rejection notification template",
        error: error.message,
        projectId: project?.id,
        documentId: currentDocument?.id,
        isDocumentLevel,
      });
      throw error;
    }
  }

  /**
   * Generate quote acceptance confirmation email template
   * Sent to Admin & Finance Manager when quote is accepted via email intent
   * @param {Object} project - Project data
   * @param {Object} document - Document data
   * @param {string} invoiceId - Invoice ID created from quote
   * @returns {Object} Email template with subject and htmlContent
   */
  static generateQuoteAcceptanceConfirmationTemplate(
    project,
    document,
    invoiceId
  ) {
    try {
      const subject = `Quote Accepted: ${project.name} - Invoice Created`;

      const escapeHtml = (text) => {
        if (!text) return "";
        return String(text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      };

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${escapeHtml(subject)}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f4f4f4;
            }
            .container {
              background-color: #ffffff;
              border-radius: 8px;
              padding: 30px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding-bottom: 20px;
              border-bottom: 2px solid #28a745;
            }
            .header h1 {
              color: #28a745;
              margin: 0;
              font-size: 24px;
            }
            .header .icon {
              font-size: 32px;
              margin-right: 10px;
            }
            .content {
              margin: 20px 0;
            }
            .info-box {
              background-color: #f8f9fa;
              border-left: 4px solid #28a745;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .info-box h3 {
              margin-top: 0;
              color: #28a745;
            }
            .info-box ul {
              list-style: none;
              padding: 0;
              margin: 10px 0;
            }
            .info-box li {
              padding: 5px 0;
            }
            .info-box strong {
              color: #333;
            }
            .success-badge {
              display: inline-block;
              background-color: #28a745;
              color: white;
              padding: 5px 15px;
              border-radius: 20px;
              font-size: 14px;
              font-weight: bold;
              margin: 10px 0;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #dee2e6;
              text-align: center;
              color: #6c757d;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1><span class="icon">✅</span>Quote Accepted & Invoice Created</h1>
              <p>The client has accepted the quote and an invoice has been generated.</p>
            </div>
            
            <div class="content">
              <div class="info-box">
                <h3>📋 Project Details</h3>
                <ul>
                  <li><strong>Client:</strong> ${escapeHtml(
                    project.client?.name || "Unknown Client"
                  )}</li>
                  <li><strong>Project:</strong> ${escapeHtml(project.name)}</li>
                  <li><strong>Quote Document ID:</strong> ${escapeHtml(
                    document.selectedQuoteId || "N/A"
                  )}</li>
                  <li><strong>Invoice ID:</strong> <span class="success-badge">${escapeHtml(
                    invoiceId || "N/A"
                  )}</span></li>
                  <li><strong>Accepted At:</strong> ${new Date().toLocaleDateString(
                    "en-NG",
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }
                  )}</li>
                </ul>
              </div>

              <div class="info-box">
                <h3>🎯 Next Steps</h3>
                <ul>
                  <li>✅ Quote has been submitted to ERP</li>
                  <li>✅ Invoice has been created and linked to quote</li>
                  <li>✅ Project has been moved to "Finalized" phase</li>
                  <li>✅ Asana project initialization has been queued</li>
                </ul>
                <p style="margin-top: 15px;"><strong>Note:</strong> The Asana project will be initialized automatically with team members assigned based on project requirements.</p>
              </div>

              <div class="info-box" style="background-color: #e7f3ff; border-left-color: #007bff;">
                <h3 style="color: #007bff;">💡 What Happens Next?</h3>
                <p>The system will automatically:</p>
                <ol>
                  <li>Create a new Asana project for this finalized project</li>
                  <li>Select appropriate team members based on project requirements</li>
                  <li>Add team members to the Asana project</li>
                  <li>Generate project description (excluding financials)</li>
                  <li>Send completion notification to Admin, Manager, and PM</li>
                </ol>
              </div>
            </div>
            
            <div class="footer">
              <p><small>This is an automated notification from Levitate Studios AI Agent.</small></p>
              <p><small>The quote acceptance was detected via email intent analysis.</small></p>
            </div>
          </div>
        </body>
        </html>
      `;

      logger.debug({
        message: "Generated quote acceptance confirmation template",
        projectId: project.id,
        documentId: document.id,
        invoiceId,
      });

      return {
        subject,
        htmlContent,
      };
    } catch (error) {
      logger.error({
        message: "Failed to generate quote acceptance confirmation template",
        error: error.message,
        projectId: project?.id,
        documentId: document?.id,
        invoiceId,
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
