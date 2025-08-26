const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const { appConfig } = require("@/config");
const { GoogleError } = require("@/utils/errors");
const { createLogger, logIntegrationCall } = require("@/utils/logger");
const { retry } = require("@/utils");

const logger = createLogger("integration:google");

// Google API client setup
class GoogleIntegration {
  constructor() {
    this.auth = new JWT({
      email: appConfig.google.clientEmail,
      key: appConfig.google.privateKey,
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });

    this.drive = google.drive({ version: "v3", auth: this.auth });
    this.docs = google.docs({ version: "v1", auth: this.auth });
  }

  // Create a new Google Doc
  async createDocument(title, content) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          // Create the document
          const doc = await this.docs.documents.create({
            requestBody: {
              title,
            },
          });

          if (content) {
            // Insert content into the document
            await this.docs.documents.batchUpdate({
              documentId: doc.data.documentId,
              requestBody: {
                requests: [
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
          }

          // Get file metadata
          const file = await this.drive.files.get({
            fileId: doc.data.documentId,
            fields: "id,name,webViewLink,webContentLink,exportLinks",
          });

          return {
            id: file.data.id,
            name: file.data.name,
            webViewLink: file.data.webViewLink,
            webContentLink: file.data.webContentLink,
            exportLinks: file.data.exportLinks,
          };
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "createDocument",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "createDocument",
        false,
        duration,
        error
      );
      throw new GoogleError("createDocument", error, { title });
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
  async shareDocument(documentId, email, role = "reader") {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          await this.drive.permissions.create({
            fileId: documentId,
            requestBody: {
              role,
              type: "user",
              emailAddress: email,
            },
            sendNotificationEmail: false,
          });
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
      throw new GoogleError("shareDocument", error, {
        documentId,
        email,
        role,
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
      const result = await retry(
        async () => {
          const file = await this.drive.files.get({
            fileId: documentId,
            fields:
              "id,name,webViewLink,webContentLink,exportLinks,createdTime,modifiedTime,lastModifyingUser",
          });

          return {
            id: file.data.id,
            name: file.data.name,
            webViewLink: file.data.webViewLink,
            webContentLink: file.data.webContentLink,
            exportLinks: file.data.exportLinks,
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
      throw new GoogleError("getDocumentMetadata", error, {
        documentId,
      });
    }
  }
}

// Create and export singleton instance
const googleIntegration = new GoogleIntegration();

module.exports = { googleIntegration };
