const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const { appConfig } = require("@/config");
const { GoogleError } = require("@/utils/errors");
const { createLogger, logIntegrationCall } = require("@/utils/logger");
const { retry } = require("@/utils");
const { getConfig, setConfig, CONFIG_KEYS } = require("@/utils/globalConfig");

const logger = createLogger("integration:google");

// Google API client setup
class GoogleIntegration {
  constructor() {
    // Validate required configuration
    this.validateConfig();

    // Initialize JWT authentication
    this.auth = new JWT({
      email: appConfig.google.clientEmail,
      key: appConfig.google.privateKey,
      subject: `info@${appConfig.emailDomain}`, // Impersonate admin user for Google Docs API
      // subject: appConfig.server.adminEmail, // Impersonate admin user for Google Docs API
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive.file",
        // "https://www.googleapis.com/auth/spreadsheets",
      ],
    });

    this.drive = google.drive({ version: "v3", auth: this.auth });
    this.docs = google.docs({ version: "v1", auth: this.auth });

    // Track authentication state
    this.isAuthenticated = false;
    this.lastAuthCheck = null;
    this.authCheckInterval = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Validate Google API configuration
   * @private
   */
  validateConfig() {
    const requiredFields = ["clientEmail", "privateKey", "projectId"];

    for (const field of requiredFields) {
      if (!appConfig.google[field]) {
        throw new GoogleError(
          "initialization",
          new Error(`Missing required Google configuration: ${field}`),
          { field }
        );
      }
    }

    // Validate private key format
    if (!appConfig.google.privateKey.includes("BEGIN PRIVATE KEY")) {
      throw new GoogleError(
        "initialization",
        new Error("Invalid private key format. Must include BEGIN/END markers"),
        { privateKeyStart: appConfig.google.privateKey.substring(0, 50) }
      );
    }

    // Validate email format
    if (
      !appConfig.google.clientEmail.includes("@") ||
      !appConfig.google.clientEmail.includes(".iam.gserviceaccount.com")
    ) {
      throw new GoogleError(
        "initialization",
        new Error("Invalid service account email format"),
        { clientEmail: appConfig.google.clientEmail }
      );
    }
  }

  /**
   * Verify authentication and service account permissions
   * @private
   */
  async verifyAuthentication() {
    const now = Date.now();

    // Skip if recently verified
    if (
      this.isAuthenticated &&
      this.lastAuthCheck &&
      now - this.lastAuthCheck < this.authCheckInterval
    ) {
      return;
    }

    try {
      // Test authentication by getting user info
      const aboutResponse = await this.drive.about.get({
        fields: "user,storageQuota",
      });

      if (!aboutResponse.data || !aboutResponse.data.user) {
        throw new Error("Invalid authentication response");
      }

      logger.info(
        {
          serviceAccount: aboutResponse.data.user.emailAddress,
          quotaUsed: aboutResponse.data.storageQuota?.usage,
          quotaLimit: aboutResponse.data.storageQuota?.limit,
        },
        "Google Drive authentication verified"
      );

      this.isAuthenticated = true;
      this.lastAuthCheck = now;
    } catch (error) {
      this.isAuthenticated = false;
      this.lastAuthCheck = null;

      logger.error(
        {
          error: error.message,
          code: error.code,
          status: error.status,
          serviceAccount: appConfig.google.clientEmail,
          projectId: appConfig.google.projectId,
          detailedError: error,
        },
        "Google Drive authentication failed"
      );

      // Provide specific error guidance
      let errorMessage = "Authentication failed";
      if (error.code === 403) {
        errorMessage =
          "Service account does not have required permissions. Ensure APIs are enabled and service account has Editor role.";
      } else if (error.code === 401) {
        errorMessage =
          "Invalid service account credentials. Check GOOGLE_PRIVATE_KEY and GOOGLE_CLIENT_EMAIL.";
      }

      throw new GoogleError("authentication", new Error(errorMessage), {
        originalError: error.message,
        code: error.code,
        serviceAccount: appConfig.google.clientEmail,
      });
    }
  }

  // Create a new Google Doc
  async createDocument(title, content, options = {}) {
    const startTime = Date.now();
    const {
      folderId = null,
      shareWithTeam = true,
      makePublicReadable = false,
    } = options;

    try {
      // Verify authentication first
      await this.verifyAuthentication();

      const result = await retry(
        async () => {
          // Validate inputs
          if (
            !title ||
            typeof title !== "string" ||
            title.trim().length === 0
          ) {
            throw new Error(
              "Document title is required and must be a non-empty string"
            );
          }

          if (content && typeof content !== "string") {
            throw new Error("Document content must be a string");
          }

          // Sanitize title (remove invalid characters for Google Docs)
          const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, "_").trim();

          logger.info(
            {
              title: sanitizedTitle,
              hasContent: !!content,
              contentLength: content?.length || 0,
              folderId,
            },
            "Creating Google Document"
          );

          // Create the document (Google Docs API doesn't support parents field)
          const createRequest = {
            requestBody: {
              title: sanitizedTitle,
            },
          };

          logger.info(
            {
              createRequest,
              serviceAccount: appConfig.google.clientEmail,
              scopes: this.auth.scopes,
            },
            "Attempting to create Google Document with request details"
          );

          const doc = await this.docs.documents.create(createRequest);

          if (!doc.data || !doc.data.documentId) {
            throw new Error(
              "Failed to create document - no document ID returned"
            );
          }

          const documentId = doc.data.documentId;

          logger.info(
            {
              documentId,
              title: sanitizedTitle,
            },
            "Google Document created successfully"
          );

          // Move to folder if specified (using Drive API after document creation)
          if (folderId) {
            try {
              await this.drive.files.update({
                fileId: documentId,
                addParents: folderId,
                fields: "id,parents",
              });

              logger.info(
                {
                  documentId,
                  folderId,
                },
                "Document moved to folder"
              );
            } catch (folderError) {
              // Log warning but don't fail - document was created successfully
              logger.warn(
                {
                  documentId,
                  folderId,
                  error: folderError.message,
                },
                "Failed to move document to folder, but document created successfully"
              );
            }
          }

          // Insert content if provided
          if (content && content.trim()) {
            try {
              await this.docs.documents.batchUpdate({
                documentId,
                requestBody: {
                  requests: [
                    {
                      insertText: {
                        location: {
                          index: 1,
                        },
                        text: content.trim(),
                      },
                    },
                  ],
                },
              });

              logger.info(
                {
                  documentId,
                  contentLength: content.length,
                },
                "Document content added successfully"
              );
            } catch (contentError) {
              logger.error(
                {
                  documentId,
                  error: contentError.message,
                },
                "Failed to add content to document"
              );
              throw new Error(
                `Failed to add content to document: ${contentError.message}`
              );
            }
          }

          // Share with team if requested
          if (shareWithTeam) {
            try {
              await this.shareDocumentWithTeam(documentId);
            } catch (shareError) {
              // Log warning but don't fail the creation
              logger.warn(
                {
                  documentId,
                  error: shareError.message,
                },
                "Failed to share document with team, but document created successfully"
              );
            }
          }

          // Make publicly readable if requested
          if (makePublicReadable) {
            try {
              await this.makeDocumentPublicReadable(documentId);
            } catch (publicError) {
              // Log warning but don't fail the creation
              logger.warn(
                {
                  documentId,
                  error: publicError.message,
                },
                "Failed to make document public, but document created successfully"
              );
            }
          }

          // Get file metadata with retry
          let file;
          try {
            file = await this.drive.files.get({
              fileId: documentId,
              fields:
                "id,name,webViewLink,webContentLink,exportLinks,parents,createdTime,modifiedTime",
            });
          } catch (metadataError) {
            logger.error(
              {
                documentId,
                error: metadataError.message,
              },
              "Failed to get document metadata"
            );
            throw new Error(
              `Failed to get document metadata: ${metadataError.message}`
            );
          }

          if (!file.data) {
            throw new Error("No file metadata returned");
          }

          return {
            id: file.data.id,
            name: file.data.name,
            webViewLink: file.data.webViewLink,
            webContentLink: file.data.webContentLink,
            exportLinks: file.data.exportLinks,
            parents: file.data.parents,
            createdTime: file.data.createdTime,
            modifiedTime: file.data.modifiedTime,
          };
        },
        3, // max attempts
        2000 // base delay
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "createDocument",
        true,
        duration
      );

      logger.info(
        {
          documentId: result.id,
          title: result.name,
          duration,
        },
        "Document creation completed successfully"
      );

      return result;
    } catch (error) {
      console.log("Google createDocument error");
      console.log(error);
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "createDocument",
        false,
        duration,
        error
      );

      logger.error(
        {
          title,
          error: error.message,
          duration,
        },
        "Document creation failed"
      );

      // Enhance error message based on error type
      let enhancedMessage = error.message;
      if (error.code === 403) {
        enhancedMessage = `Permission denied: Service account '${appConfig.google.clientEmail}' lacks permission to create documents. Ensure the service account has Editor role and APIs are enabled.`;
      } else if (error.code === 401) {
        enhancedMessage =
          "Authentication failed: Invalid service account credentials. Check GOOGLE_PRIVATE_KEY and GOOGLE_CLIENT_EMAIL.";
      } else if (error.code === 429) {
        enhancedMessage =
          "Rate limit exceeded: Too many requests to Google API. Retry after delay.";
      }

      throw new GoogleError("createDocument", new Error(enhancedMessage), {
        title,
        originalError: error.message,
        code: error.code,
        serviceAccount: appConfig.google.clientEmail,
      });
    }
  }

  /**
   * Share document with team members
   * @private
   */
  // TODO: Also make this a new  method shareDocument so we can pass array of email and roles to share with
  async shareDocumentWithTeam(documentId) {
    try {
      // Share with admin email if configured
      if (appConfig.server.adminEmail) {
        await this.drive.permissions.create({
          fileId: documentId,
          requestBody: {
            role: "writer",
            type: "user",
            emailAddress: appConfig.server.adminEmail,
          },
          sendNotificationEmail: false,
        });
        // TODO: Remove this after testing
        await this.shareDocument(
          documentId,
          "okohfavour91@gmail.com",
          "writer"
        );

        logger.info(
          {
            documentId,
            email: appConfig.server.adminEmail,
          },
          "Document shared with admin"
        );
      }
    } catch (error) {
      logger.warn(
        {
          documentId,
          error: error.message,
        },
        "Failed to share document with team"
      );
      throw error;
    }
  }

  /**
   * Make document publicly readable
   * @private
   */
  async makeDocumentPublicReadable(documentId) {
    try {
      await this.drive.permissions.create({
        fileId: documentId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
        sendNotificationEmail: false,
      });

      logger.info(
        {
          documentId,
        },
        "Document made publicly readable"
      );
    } catch (error) {
      logger.warn(
        {
          documentId,
          error: error.message,
        },
        "Failed to make document public"
      );
      throw error;
    }
  }

  // Update document content
  async updateDocument(documentId, content) {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          // Get current document content to determine insertion point
          const doc = await this.docs.documents.get({
            documentId,
          });

          const endIndex =
            doc.data.body.content[doc.data.body.content.length - 1].endIndex -
            1;

          // Clear existing content and insert new content
          await this.docs.documents.batchUpdate({
            documentId,
            requestBody: {
              requests: [
                {
                  deleteContentRange: {
                    range: {
                      startIndex: 1,
                      endIndex,
                    },
                  },
                },
                {
                  insertText: {
                    location: {
                      index: 1,
                    },
                    text: content,
                  },
                },
              ],
            },
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "updateDocument",
        true,
        duration
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "updateDocument",
        false,
        duration,
        error
      );
      throw new GoogleError("updateDocument", error, { documentId });
    }
  }

  // Export document as plain text
  async exportDocumentAsText(documentId) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const response = await this.drive.files.export({
            fileId: documentId,
            mimeType: "text/plain",
          });

          return response.data;
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "exportDocumentAsText",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "exportDocumentAsText",
        false,
        duration,
        error
      );
      throw new GoogleError("exportDocumentAsText", error, {
        documentId,
      });
    }
  }

  // Export document as HTML
  async exportDocumentAsHtml(documentId) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const response = await this.drive.files.export({
            fileId: documentId,
            mimeType: "text/html",
          });

          return response.data;
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "exportDocumentAsHtml",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "exportDocumentAsHtml",
        false,
        duration,
        error
      );
      throw new GoogleError("exportDocumentAsHtml", error, {
        documentId,
      });
    }
  }

  // Create a copy of a document
  async copyDocument(documentId, newTitle) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const copy = await this.drive.files.copy({
            fileId: documentId,
            requestBody: {
              name: newTitle,
            },
            fields: "id,name,webViewLink,webContentLink,exportLinks",
          });

          return {
            id: copy.data.id,
            name: copy.data.name,
            webViewLink: copy.data.webViewLink,
            webContentLink: copy.data.webContentLink,
            exportLinks: copy.data.exportLinks,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "copyDocument",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "copyDocument",
        false,
        duration,
        error
      );
      throw new GoogleError("copyDocument", error, {
        documentId,
        newTitle,
      });
    }
  }

  // Get document revisions
  async getDocumentRevisions(documentId) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const response = await this.drive.revisions.list({
            fileId: documentId,
            fields: "revisions(id,modifiedTime,lastModifyingUser,keepForever)",
          });

          return response.data.revisions || [];
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "getDocumentRevisions",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "getDocumentRevisions",
        false,
        duration,
        error
      );
      throw new GoogleError("getDocumentRevisions", error, {
        documentId,
      });
    }
  }

  // Set revision to keep forever (for important milestones)
  async keepRevisionForever(documentId, revisionId) {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          await this.drive.revisions.update({
            fileId: documentId,
            revisionId,
            requestBody: {
              keepForever: true,
            },
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "keepRevisionForever",
        true,
        duration
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "keepRevisionForever",
        false,
        duration,
        error
      );
      throw new GoogleError("keepRevisionForever", error, {
        documentId,
        revisionId,
      });
    }
  }

  // Share document with specific permissions
  async shareDocument(documentId, email, role = "reader", options = {}) {
    const startTime = Date.now();
    const { sendNotification = false, expirationTime = null } = options;

    try {
      // Verify authentication first
      await this.verifyAuthentication();

      // Validate inputs
      if (!documentId || typeof documentId !== "string") {
        throw new Error("Document ID is required and must be a string");
      }

      if (!email || typeof email !== "string" || !email.includes("@")) {
        throw new Error("Valid email address is required");
      }

      const validRoles = ["reader", "commenter", "writer", "owner"];
      if (!validRoles.includes(role)) {
        throw new Error(
          `Invalid role. Must be one of: ${validRoles.join(", ")}`
        );
      }

      await retry(
        async () => {
          const permissionRequest = {
            fileId: documentId,
            requestBody: {
              role,
              type: "user",
              emailAddress: email,
            },
            sendNotificationEmail: sendNotification,
          };

          // Add expiration time if specified
          if (expirationTime) {
            permissionRequest.requestBody.expirationTime = expirationTime;
          }

          const result = await this.drive.permissions.create(permissionRequest);

          logger.info(
            {
              documentId,
              email,
              role,
              permissionId: result.data.id,
            },
            "Document shared successfully"
          );

          return result;
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "shareDocument",
        true,
        duration
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "shareDocument",
        false,
        duration,
        error
      );

      // Enhance error message
      let enhancedMessage = error.message;
      if (error.code === 403) {
        enhancedMessage =
          "Permission denied: Cannot share document. Service account may lack permission or document may not exist.";
      } else if (error.code === 404) {
        enhancedMessage = `Document not found: Document ID '${documentId}' does not exist or is not accessible.`;
      }

      throw new GoogleError("shareDocument", new Error(enhancedMessage), {
        documentId,
        email,
        role,
        originalError: error.message,
        code: error.code,
      });
    }
  }

  // Delete document
  async deleteDocument(documentId) {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          await this.drive.files.delete({
            fileId: documentId,
          });
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "deleteDocument",
        true,
        duration
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "deleteDocument",
        false,
        duration,
        error
      );
      throw new GoogleError("deleteDocument", error, { documentId });
    }
  }

  // Get document metadata
  async getDocumentMetadata(documentId) {
    const startTime = Date.now();

    try {
      // Verify authentication first
      await this.verifyAuthentication();

      // Validate input
      if (!documentId || typeof documentId !== "string") {
        throw new Error("Document ID is required and must be a string");
      }

      const result = await retry(
        async () => {
          const file = await this.drive.files.get({
            fileId: documentId,
            fields:
              "id,name,webViewLink,webContentLink,exportLinks,createdTime,modifiedTime,lastModifyingUser,parents,size,mimeType,owners,permissions",
          });

          if (!file.data) {
            throw new Error("No file data returned");
          }

          return {
            id: file.data.id,
            name: file.data.name,
            webViewLink: file.data.webViewLink,
            webContentLink: file.data.webContentLink,
            exportLinks: file.data.exportLinks,
            createdTime: file.data.createdTime,
            modifiedTime: file.data.modifiedTime,
            lastModifyingUser: file.data.lastModifyingUser,
            parents: file.data.parents,
            size: file.data.size,
            mimeType: file.data.mimeType,
            owners: file.data.owners,
            permissionCount: file.data.permissions?.length || 0,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "getDocumentMetadata",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "getDocumentMetadata",
        false,
        duration,
        error
      );

      // Enhance error message
      let enhancedMessage = error.message;
      if (error.code === 404) {
        enhancedMessage = `Document not found: Document ID '${documentId}' does not exist or is not accessible.`;
      } else if (error.code === 403) {
        enhancedMessage = `Permission denied: Service account cannot access document '${documentId}'.`;
      }

      throw new GoogleError("getDocumentMetadata", new Error(enhancedMessage), {
        documentId,
        originalError: error.message,
        code: error.code,
      });
    }
  }

  /**
   * Test Google APIs connectivity and permissions
   * This is a diagnostic method to help troubleshoot permission issues
   */
  async testAPIConnectivity() {
    const results = {
      driveAPI: { success: false, error: null },
      docsAPI: { success: false, error: null },
      authentication: { success: false, error: null },
    };

    // Test Drive API by getting user info
    try {
      // Test Drive API
      logger.info("Testing Google Drive API connectivity");
      const aboutResponse = await this.drive.about.get({
        fields: "user,storageQuota",
      });

      if (aboutResponse.data && aboutResponse.data.user) {
        results.driveAPI.success = true;
        results.authentication.success = true;
        logger.info(
          {
            serviceAccount: aboutResponse.data.user.emailAddress,
          },
          "Google Drive API test successful"
        );
      }
    } catch (error) {
      results.driveAPI.error = {
        message: error.message,
        code: error.code,
        status: error.status,
      };
      logger.error(
        {
          error: error.message,
          code: error.code,
        },
        "Google Drive API test failed"
      );
    }

    // Test Drive API by creating a test folder
    // try {
    //   logger.info("Testing Google Drive API connectivity with folder creation");

    //   const testFolderName = "API_TEST_FOLDER_DELETE_ME_" + Date.now();
    //   const folderMetadata = {
    //     name: testFolderName,
    //     mimeType: "application/vnd.google-apps.folder",
    //   };

    //   const folderResponse = await this.drive.files.create({
    //     requestBody: folderMetadata,
    //     fields: "id,name",
    //   });

    //   if (folderResponse.data && folderResponse.data.id) {
    //     results.driveAPI.success = true;
    //     results.authentication.success = true;
    //     logger.info(
    //       {
    //         folderId: folderResponse.data.id,
    //         folderName: folderResponse.data.name,
    //       },
    //       "Google Drive API test successful - created test folder"
    //     );

    //     // Clean up the test folder
    //     try {
    //       await this.drive.files.delete({
    //         fileId: folderResponse.data.id,
    //       });
    //       logger.info("Test folder cleaned up successfully");
    //     } catch (cleanupError) {
    //       logger.warn(
    //         {
    //           folderId: folderResponse.data.id,
    //           error: cleanupError.message,
    //         },
    //         "Failed to clean up test folder"
    //       );
    //     }
    //   }
    // } catch (error) {
    //   results.driveAPI.error = {
    //     message: error.message,
    //     code: error.code,
    //     status: error.status,
    //   };
    //   logger.error(
    //     {
    //       error: error.message,
    //       code: error.code,
    //     },
    //     "Google Drive API test failed"
    //   );
    // }

    // // Test Docs API by attempting to create a minimal google doc test document
    try {
      // Test Docs API by attempting to create a minimal test document
      logger.info(
        "Testing Google Docs API connectivity with minimal document creation"
      );

      const testDoc = await this.docs.documents.create({
        requestBody: {
          title: "API_TEST_DOCUMENT_DELETE_ME_" + Date.now(),
        },
      });

      if (testDoc.data && testDoc.data.documentId) {
        results.docsAPI.success = true;
        logger.info(
          {
            documentId: testDoc.data.documentId,
          },
          "Google Docs API test successful - created test document"
        );

        // Clean up the test document
        try {
          await this.drive.files.delete({
            fileId: testDoc.data.documentId,
          });
          logger.info("Test document cleaned up successfully");
        } catch (cleanupError) {
          logger.warn(
            {
              documentId: testDoc.data.documentId,
              error: cleanupError.message,
            },
            "Failed to clean up test document"
          );
        }
      }
    } catch (error) {
      results.docsAPI.error = {
        message: error.message,
        code: error.code,
        status: error.status,
      };
      logger.error(
        {
          error: error.message,
          code: error.code,
          status: error.status,
        },
        "Google Docs API test failed"
      );
      console.log(error);
      console.log("error?.errors");
      console.log(error?.errors);
      console.log("error?.response?.data?.error");
      console.log(error?.response?.data?.error);
      console.log("error?.response?.config?.data");
      console.log(error?.response?.config?.data);
    }

    // // Test Docs API by attempting to read an existing Google Doc
    // try {
    //   // Test Docs API by attempting to read an existing Google Doc
    //   logger.info(
    //     "Testing Google Docs API connectivity by reading existing document"
    //   );

    //   // First, find any Google Doc file in the drive
    //   const searchResponse = await this.drive.files.list({
    //     q: "mimeType='application/vnd.google-apps.document' and trashed=false",
    //     fields: "files(id,name)",
    //     pageSize: 4,
    //   });
    //   console.log("searchResponse.data?.files");
    //   console.log(searchResponse.data?.files);

    //   if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    //     const testDocumentId = searchResponse.data.files[0].id;
    //     const testDocumentName = searchResponse.data.files[0].name;

    //     logger.info(
    //       {
    //         documentId: testDocumentId,
    //         documentName: testDocumentName,
    //       },
    //       "Found existing document for testing"
    //     );

    //     // Attempt to read the document content
    //     const doc = await this.docs.documents.get({
    //       documentId: testDocumentId,
    //     });

    //     if (doc.data && doc.data.body) {
    //       results.docsAPI.success = true;

    //       // Extract text content from the document
    //       let documentText = "";
    //       if (doc.data.body.content) {
    //         for (const element of doc.data.body.content) {
    //           if (element.paragraph && element.paragraph.elements) {
    //             for (const textElement of element.paragraph.elements) {
    //               if (textElement.textRun && textElement.textRun.content) {
    //                 documentText += textElement.textRun.content;
    //               }
    //             }
    //           }
    //         }
    //       }

    //       console.log("=== GOOGLE DOCS CONTENT ===");
    //       console.log(`Document: ${testDocumentName}`);
    //       console.log(`Document ID: ${testDocumentId}`);
    //       // console.log("Content:");
    //       // console.log(documentText);
    //       console.log("=== END GOOGLE DOCS CONTENT ===");

    //       logger.info(
    //         {
    //           documentId: testDocumentId,
    //           documentName: testDocumentName,
    //           contentLength: documentText.length,
    //         },
    //         "Google Docs API test successful - read document content"
    //       );
    //     }
    //   } else {
    //     // No documents found - try to create one for testing
    //     logger.info("No existing documents found, creating test document");

    //     const testDoc = await this.docs.documents.create({
    //       requestBody: {
    //         title: "API_TEST_DOCUMENT_DELETE_ME_" + Date.now(),
    //       },
    //     });

    //     if (testDoc.data && testDoc.data.documentId) {
    //       results.docsAPI.success = true;

    //       console.log("=== GOOGLE DOCS TEST ===");
    //       console.log("Created empty test document successfully");
    //       console.log(`Document ID: ${testDoc.data.documentId}`);
    //       console.log("=== END GOOGLE DOCS TEST ===");

    //       logger.info(
    //         {
    //           documentId: testDoc.data.documentId,
    //         },
    //         "Google Docs API test successful - created test document"
    //       );

    //       // Clean up the test document
    //       try {
    //         await this.drive.files.delete({
    //           fileId: testDoc.data.documentId,
    //         });
    //         logger.info("Test document cleaned up successfully");
    //       } catch (cleanupError) {
    //         logger.warn(
    //           {
    //             documentId: testDoc.data.documentId,
    //             error: cleanupError.message,
    //           },
    //           "Failed to clean up test document"
    //         );
    //       }
    //     }
    //   }
    // } catch (error) {
    //   results.docsAPI.error = {
    //     message: error.message,
    //     code: error.code,
    //     status: error.status,
    //   };
    //   logger.error(
    //     {
    //       error: error.message,
    //       code: error.code,
    //       status: error.status,
    //     },
    //     "Google Docs API test failed"
    //   );
    //   console.log(error);
    //   console.log("error?.errors");
    //   console.log(error?.errors);
    //   console.log("error?.response?.data?.error");
    //   console.log(error?.response?.data?.error);
    //   console.log("error?.response?.config?.data");
    //   console.log(error?.response?.config?.data);
    // }

    return results;
  }

  /**
   * Create a folder in Google Drive for document organization
   */
  async createFolder(name, parentFolderId = null) {
    const startTime = Date.now();

    try {
      // Verify authentication first
      await this.verifyAuthentication();

      // Validate input
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        throw new Error(
          "Folder name is required and must be a non-empty string"
        );
      }

      const sanitizedName = name.replace(/[<>:"/\\|?*]/g, "_").trim();

      const result = await retry(
        async () => {
          const folderRequest = {
            requestBody: {
              name: sanitizedName,
              mimeType: "application/vnd.google-apps.folder",
            },
            fields: "id,name,webViewLink,createdTime",
          };

          if (parentFolderId) {
            folderRequest.requestBody.parents = [parentFolderId];
          }

          const folder = await this.drive.files.create(folderRequest);

          logger.info(
            {
              folderId: folder.data.id,
              name: sanitizedName,
              parentFolderId,
            },
            "Google Drive folder created"
          );

          return {
            id: folder.data.id,
            name: folder.data.name,
            webViewLink: folder.data.webViewLink,
            createdTime: folder.data.createdTime,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "createFolder",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "createFolder",
        false,
        duration,
        error
      );

      throw new GoogleError("createFolder", error, {
        name,
        parentFolderId,
        originalError: error.message,
        code: error.code,
      });
    }
  }

  /**
   * Get or create the main documents folder for the application
   * Uses global config to store folder ID for reuse
   */
  async ensureDocumentsFolder() {
    const folderName = "Levitate Studios - AI Agent Generated Documents";
    const configKey = CONFIG_KEYS.GOOGLE_DOCUMENTS_FOLDER;

    try {
      // Try to get folder ID from global config first
      const storedConfig = await getConfig(configKey);

      if (storedConfig && storedConfig.folderId) {
        try {
          // Verify the folder still exists in Google Drive
          const folder = await this.drive.files.get({
            fileId: storedConfig.folderId,
            fields: "id,name,webViewLink,trashed",
          });

          if (!folder.data.trashed) {
            logger.info(
              {
                folderId: folder.data.id,
                name: folder.data.name,
              },
              "Using cached documents folder from global config"
            );

            return {
              id: folder.data.id,
              name: folder.data.name,
              webViewLink: folder.data.webViewLink,
            };
          } else {
            logger.warn(
              {
                folderId: storedConfig.folderId,
              },
              "Cached folder is trashed, will create new one"
            );
          }
        } catch (verifyError) {
          logger.warn(
            {
              folderId: storedConfig.folderId,
              error: verifyError.message,
            },
            "Cached folder no longer exists, will create new one"
          );
        }
      }

      // Search for existing folder by name
      const searchResponse = await this.drive.files.list({
        q: `name="${folderName}" and mimeType="application/vnd.google-apps.folder" and trashed=false`,
        fields: "files(id,name,webViewLink)",
      });

      let folder;

      if (searchResponse.data.files && searchResponse.data.files.length > 0) {
        folder = searchResponse.data.files[0];
        logger.info(
          {
            folderId: folder.id,
            name: folder.name,
          },
          "Found existing documents folder by search"
        );
      } else {
        // Create new folder if not found
        folder = await this.createFolder(folderName);

        // Share with admin if configured
        if (appConfig.server.adminEmail) {
          try {
            await this.shareDocument(
              folder.id,
              appConfig.server.adminEmail,
              "writer"
            );
            // TODO: Remove this after testing
            await this.shareDocument(
              folder.id,
              "okohfavour91@gmail.com",
              "writer"
            );
          } catch (shareError) {
            logger.warn(
              {
                folderId: folder.id,
                error: shareError.message,
              },
              "Failed to share documents folder with admin"
            );
          }
        }

        logger.info(
          {
            folderId: folder.id,
            name: folder.name,
          },
          "Created new documents folder"
        );
      }

      // Store folder info in global config for future use
      try {
        await setConfig(
          configKey,
          {
            folderId: folder.id,
            folderName: folder.name,
            webViewLink: folder.webViewLink,
            createdAt: new Date().toISOString(),
            lastVerified: new Date().toISOString(),
          },
          "Google Drive documents folder configuration"
        );

        logger.info(
          {
            folderId: folder.id,
          },
          "Documents folder configuration saved to global config"
        );
      } catch (configError) {
        // Don't fail if we can't save to config - just log warning
        logger.warn(
          {
            folderId: folder.id,
            error: configError.message,
          },
          "Failed to save documents folder to global config"
        );
      }

      return folder;
    } catch (error) {
      logger.error(
        {
          error: error.message,
        },
        "Failed to ensure documents folder exists"
      );
      throw error;
    }
  }
}

// Create and export singleton instance
let googleIntegration;

// Initialize with error handling
try {
  googleIntegration = new GoogleIntegration();
  logger.info("Google integration initialized successfully");
} catch (error) {
  logger.error(
    {
      error: error.message,
      context: error.context,
    },
    "Failed to initialize Google integration"
  );
  throw error;
}

module.exports = { googleIntegration };
