const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const { appConfig } = require("@/config");
const { GoogleError } = require("@/utils/errors");
const { createLogger, logIntegrationCall } = require("@/utils/logger");
const { retry } = require("@/utils");
const { getConfig, setConfig, CONFIG_KEYS } = require("@/utils/globalConfig");
const { BlockType } = require("@/constants");
const { Readable } = require("stream");

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
    const { folderId = null, makePublicReadable = false } = options;

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

          // Share with admin always
          try {
            await this.shareDocumentWithAdmin(documentId);
          } catch (shareError) {
            // Log warning but don't fail the creation
            logger.warn(
              {
                documentId,
                error: shareError.message,
              },
              "Failed to share document with admin, but document created successfully"
            );
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
   * Create a formatted Google Doc using the Docs batchUpdate API with advanced formatting capabilities
   * This method provides comprehensive document creation with styling, sharing, and error handling
   *
   * @param {string} title - Document title
   * @param {Array} blocks - Array of content blocks describing what to insert
   *   Supported block types:
   *     { type: 'heading', text, level, style?: {bold, italic, fontSize, color} }
   *     { type: 'paragraph', text, style?: {bold, italic, fontSize, color, alignment} }
   *     { type: 'styled', text, style: {bold, italic, underline, fontSize, foregroundColor: {red,green,blue}} }
   *     { type: 'link', text, url }
   *     { type: 'table', rows: [[cellText,...],[...]], style?: {borderWidth, backgroundColor} }
   *     { type: 'bullets', items: ['one','two'], style?: {bulletPreset} }
   *     { type: 'numbered', items: [...], style?: {bulletPreset} }
   *     { type: 'image', url, width?, height? }
   *     { type: 'spacer', height? } // adds vertical spacing
   * @param {Object} options - Configuration options
   *   { folderId?, makePublicReadable?, shareWithEmails? }
   * @returns {Promise<Object>} Document creation result with metadata
   */
  async createFormattedDocument(title, blocks = [], options = {}) {
    const startTime = Date.now();
    const {
      folderId = null,
      makePublicReadable = false,
      shareWithEmails = [],
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

          if (!Array.isArray(blocks)) {
            throw new Error("Blocks must be an array");
          }

          // Sanitize title (remove invalid characters for Google Docs)
          const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, "_").trim();

          logger.info(
            {
              title: sanitizedTitle,
              blocksCount: blocks.length,
              folderId,
              makePublicReadable,
              shareWithEmailsCount: shareWithEmails.length,
            },
            "Creating formatted Google Document"
          );

          // Step 1: Create the document
          const createRequest = {
            requestBody: {
              title: sanitizedTitle,
            },
          };

          const doc = await this.docs.documents.create(createRequest);

          if (!doc.data || !doc.data.documentId) {
            throw new Error(
              "Failed to create document - no document ID returned"
            );
          }

          const documentId = doc.data.documentId;

          // Step 2: Process blocks and create formatted content
          if (blocks.length > 0) {
            await this.processDocumentBlocks(documentId, blocks);
          }

          // Step 3: Move to folder if specified
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

          // Step 4: Share with admin always

          try {
            await this.shareDocumentWithAdmin(documentId);
          } catch (shareError) {
            // Log warning but don't fail the creation
            logger.warn(
              {
                documentId,
                error: shareError.message,
              },
              "Failed to share document with admin, but document created successfully"
            );
          }

          // Step 5: Share with additional emails if provided
          if (shareWithEmails.length > 0) {
            try {
              const recipients = shareWithEmails.map((email) => ({
                email: typeof email === "string" ? email : email.email,
                role:
                  typeof email === "string" ? "reader" : email.role || "reader",
                options: typeof email === "string" ? {} : email.options || {},
              }));

              await this.shareDocument(documentId, recipients);
            } catch (shareError) {
              // Log warning but don't fail the creation
              logger.warn(
                {
                  documentId,
                  error: shareError.message,
                },
                "Failed to share document with additional emails, but document created successfully"
              );
            }
          }

          // Step 6: Make publicly readable if requested
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

          // Step 7: Get file metadata
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
        "createFormattedDocument",
        true,
        duration
      );

      logger.info(
        {
          documentId: result.id,
          title: result.name,
          duration,
        },
        "Formatted document creation completed successfully"
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "createFormattedDocument",
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
        "Formatted document creation failed"
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

      throw new GoogleError(
        "createFormattedDocument",
        new Error(enhancedMessage),
        {
          title,
          originalError: error.message,
          code: error.code,
          serviceAccount: appConfig.google.clientEmail,
        }
      );
    }
  }

  /**
   * Process document blocks and apply formatting using batchUpdate
   * Uses a robust "Create, Inspect, Fill" strategy for tables to ensure accuracy.
   * @private
   */
  async processDocumentBlocks(documentId, blocks) {
    try {
      if (!Array.isArray(blocks) || blocks.length === 0) return;

      // Initialize index
      let currentIndex = await this.getDocumentEndIndex(documentId);
      let currentBatch = [];

      for (const block of blocks) {
        if (!block || !block.type) continue;

        // --- SPECIAL HANDLING FOR TABLES ---
        if (block.type === BlockType.TABLE) {
          // 1. Flush any pending text blocks first
          if (currentBatch.length > 0) {
            await this.docs.documents.batchUpdate({
              documentId,
              requestBody: { requests: currentBatch },
            });
            currentBatch = [];
          }

          // 2. Handle the table completely (Create -> Fetch Layout -> Fill)
          await this.processTableBlock(documentId, block);

          // 3. Re-sync index for subsequent blocks
          currentIndex = await this.getDocumentEndIndex(documentId);
          continue;
        }
        // -----------------------------------

        // Normal processing for text/images/spacers
        const { requests: blockRequests, insertedLength } =
          await this.buildBlockRequests(documentId, block, currentIndex);

        if (blockRequests.length > 0) {
          currentBatch.push(...blockRequests);
          currentIndex += insertedLength;
        }
      }

      // Flush remaining requests
      if (currentBatch.length > 0) {
        await this.docs.documents.batchUpdate({
          documentId,
          requestBody: { requests: currentBatch },
        });
      }

      logger.info({ documentId }, "All blocks processed successfully");
    } catch (error) {
      logger.error(
        { documentId, error: error.message },
        "Failed to process document blocks"
      );
      throw new Error(`Failed to process document blocks: ${error.message}`);
    }
  }

  /**
   * specialized handler for Tables that creates the grid,
   * then fetches the doc to find the exact cell indices to fill.
   * @private
   */
  async processTableBlock(documentId, block) {
    if (!block.rows || block.rows.length === 0) return;

    const rows = block.rows.length;
    const cols = Math.max(
      ...block.rows.map((row) => (Array.isArray(row) ? row.length : 0))
    );
    if (cols === 0) return;

    // 1. Create the empty table at the very end of the document
    await this.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertTable: {
              rows,
              columns: cols,
              endOfSegmentLocation: { segmentId: "" }, // Safe insertion at end
            },
          },
        ],
      },
    });

    // 2. Fetch the document to get the REAL indices of the new table cells
    // This removes all "math guessing" and fixes the empty table issue.
    const doc = await this.docs.documents.get({ documentId });
    const bodyContent = doc.data.body.content;
    const lastElement = bodyContent[bodyContent.length - 1];

    // The table should be the last structural element (or second to last if there's a trailing newline)
    // We search backwards for the table.
    let table = null;
    for (let i = bodyContent.length - 1; i >= 0; i--) {
      if (bodyContent[i].table) {
        table = bodyContent[i].table;
        break;
      }
    }

    if (!table) {
      logger.warn(
        { documentId },
        "Created table but could not find it in doc structure"
      );
      return;
    }

    // 3. Construct requests to fill the cells
    const textRequests = [];

    // Iterate rows and cells safely
    for (let r = 0; r < Math.min(rows, table.tableRows.length); r++) {
      const rowData = block.rows[r];
      if (!Array.isArray(rowData)) continue;

      const tableRow = table.tableRows[r];

      for (let c = 0; c < Math.min(cols, tableRow.tableCells.length); c++) {
        const cellText = rowData[c];
        if (!cellText || typeof cellText !== "string" || !cellText.trim())
          continue;

        // The API guarantees content inside a cell. We insert at the START index of the cell.
        // tableRow.tableCells[c].content usually starts with a paragraph.
        // We generally want to insert at `startIndex` of the cell's first content element.
        // However, safest is `startIndex` of the cell struct + 1?
        // Actually, looking at the JSON structure, tableCell has `startIndex`.
        // Writing at `startIndex + 1` usually lands inside the cell.
        // BUT, a cell always contains a Paragraph.
        // The safest target is the `startIndex` of the first paragraph *inside* the cell.

        const cell = tableRow.tableCells[c];
        let insertIndex = cell.startIndex; // Default fallback

        // Find the first paragraph content in the cell to get a valid text insertion index
        if (cell.content && cell.content.length > 0) {
          insertIndex = cell.content[0].startIndex;
        }

        textRequests.push({
          insertText: {
            location: { index: insertIndex },
            text: cellText,
          },
        });
      }
    }

    // 4. Send the fill requests AND the safety newline in one go
    // Note: We use endOfSegmentLocation for the newline to avoid index math errors again.
    if (textRequests.length > 0) {
      // Reverse requests to keep indices valid (inserting later text first)
      // Actually, since we fetched absolute indices from the doc,
      // we must process them in REVERSE order of index so earlier inserts don't shift later ones.
      textRequests.sort(
        (a, b) => b.insertText.location.index - a.insertText.location.index
      );

      const finalRequests = [...textRequests];

      // Add safety newline after table
      finalRequests.push({
        insertText: {
          endOfSegmentLocation: { segmentId: "" },
          text: "\n",
        },
      });

      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: finalRequests },
      });
    } else {
      // Just the safety newline
      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                endOfSegmentLocation: { segmentId: "" },
                text: "\n",
              },
            },
          ],
        },
      });
    }
  }

  /**
   * Get the current end index of the document body
   * @private
   */
  async getDocumentEndIndex(documentId) {
    try {
      const doc = await this.docs.documents.get({ documentId });
      const body = doc.data?.body?.content;
      if (Array.isArray(body) && body.length > 0) {
        return body[body.length - 1].endIndex - 1;
      }
    } catch (error) {
      logger.warn(
        { documentId, error: error.message },
        "Failed to fetch document end index, defaulting to 1"
      );
    }
    return 1;
  }

  /**
   * Build Docs API requests for a single block without issuing API calls.
   * Returns the request set and the logical length inserted.
   * @private
   */
  async buildBlockRequests(documentId, block, startIndex) {
    const requests = [];
    let insertedLength = 0;

    switch (block.type) {
      case BlockType.IMAGE: {
        if (!(block.url || block.fileId)) break;

        let imageUrl = block.url;
        if (block.fileId) {
          try {
            const file = await this.drive.files.get({
              fileId: block.fileId,
              fields: "webContentLink,webViewLink",
            });
            imageUrl =
              file.data.webContentLink ||
              file.data.webViewLink ||
              imageUrl ||
              null;
          } catch (fileError) {
            logger.warn(
              { documentId, fileId: block.fileId, error: fileError.message },
              "Falling back to text placeholder for image"
            );
            imageUrl = null;
          }
        }

        if (!imageUrl) {
          const placeholder = "[Image placeholder - could not load image]\n";
          requests.push({
            insertText: { location: { index: startIndex }, text: placeholder },
          });
          insertedLength = placeholder.length;
          break;
        }

        const width = block.width || 300;
        const height = block.height || null;

        const imageRequest = {
          insertInlineImage: {
            location: { index: startIndex },
            uri: imageUrl,
            objectSize: { width: { magnitude: width, unit: "PT" } },
          },
        };
        if (height) {
          imageRequest.insertInlineImage.objectSize.height = {
            magnitude: height,
            unit: "PT",
          };
        }

        requests.push(imageRequest);
        requests.push({
          insertText: { location: { index: startIndex + 1 }, text: "\n" },
        });
        insertedLength = 2; // image placeholder + newline in Docs index space
        break;
      }

      case BlockType.HEADING: {
        if (!block.text) break;
        const text = `${block.text}\n`;
        requests.push({
          insertText: { location: { index: startIndex }, text },
        });
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex,
              endIndex: startIndex + block.text.length,
            },
            paragraphStyle: {
              namedStyleType: `HEADING_${Math.min(
                Math.max(block.level || 1, 1),
                6
              )}`,
            },
            fields: "namedStyleType",
          },
        });
        insertedLength = text.length;
        break;
      }

      case BlockType.PARAGRAPH: {
        if (!block.text) break;
        const text = `${block.text}\n`;
        requests.push({
          insertText: { location: { index: startIndex }, text },
        });

        // Optional paragraph style (alignment/indentation)
        if (block.style && Object.keys(block.style).length > 0) {
          const paragraphStyle = {};
          const fields = [];

          if (block.style.alignment) {
            paragraphStyle.alignment = block.style.alignment;
            fields.push("alignment");
          }
          if (block.style.indentStart) {
            paragraphStyle.indentStart = {
              magnitude: block.style.indentStart,
              unit: "PT",
            };
            fields.push("indentStart");
          }
          if (block.style.indentEnd) {
            paragraphStyle.indentEnd = {
              magnitude: block.style.indentEnd,
              unit: "PT",
            };
            fields.push("indentEnd");
          }
          if (block.style.lineSpacing) {
            paragraphStyle.lineSpacing = block.style.lineSpacing;
            fields.push("lineSpacing");
          }

          if (fields.length > 0) {
            requests.push({
              updateParagraphStyle: {
                range: {
                  startIndex,
                  endIndex: startIndex + block.text.length,
                },
                paragraphStyle,
                fields: fields.join(","),
              },
            });
          }
        }

        insertedLength = text.length;
        break;
      }

      case BlockType.STYLED: {
        if (!block.text || !block.style) break;
        const text = `${block.text}\n`;
        requests.push({
          insertText: { location: { index: startIndex }, text },
        });

        const textStyle = {};
        const fields = [];

        if (block.style.bold) {
          textStyle.bold = true;
          fields.push("bold");
        }
        if (block.style.italic) {
          textStyle.italic = true;
          fields.push("italic");
        }
        if (block.style.underline) {
          textStyle.underline = true;
          fields.push("underline");
        }
        if (block.style.strikethrough) {
          textStyle.strikethrough = true;
          fields.push("strikethrough");
        }
        if (block.style.fontSize) {
          textStyle.fontSize = {
            magnitude: block.style.fontSize,
            unit: "PT",
          };
          fields.push("fontSize");
        }
        if (block.style.fontFamily) {
          textStyle.weightedFontFamily = { fontFamily: block.style.fontFamily };
          fields.push("weightedFontFamily");
        }
        if (block.style.foregroundColor) {
          textStyle.foregroundColor = {
            color: { rgbColor: block.style.foregroundColor },
          };
          fields.push("foregroundColor");
        }
        if (block.style.backgroundColor) {
          textStyle.backgroundColor = {
            color: { rgbColor: block.style.backgroundColor },
          };
          fields.push("backgroundColor");
        }
        if (block.style.link) {
          textStyle.link = { url: block.style.link };
          fields.push("link");
        }

        if (fields.length > 0) {
          requests.push({
            updateTextStyle: {
              range: {
                startIndex,
                endIndex: startIndex + block.text.length,
              },
              textStyle,
              fields: fields.join(","),
            },
          });
        }

        insertedLength = text.length;
        break;
      }

      case BlockType.LINK: {
        if (!block.text || !block.url) break;
        const text = `${block.text}\n`;
        requests.push({
          insertText: { location: { index: startIndex }, text },
        });
        requests.push({
          updateTextStyle: {
            range: { startIndex, endIndex: startIndex + block.text.length },
            textStyle: { link: { url: block.url } },
            fields: "link",
          },
        });
        insertedLength = text.length;
        break;
      }

      case BlockType.BULLETS:
      case BlockType.NUMBERED: {
        if (!Array.isArray(block.items) || block.items.length === 0) break;
        const text = block.items.map((item) => `${item}\n`).join("");
        requests.push({
          insertText: { location: { index: startIndex }, text },
        });
        // Docs API bullet presets:
        // - bullets: BULLET_DISC_CIRCLE_SQUARE (safe generic preset)
        // - numbered: NUMBERED_DECIMAL_ALPHA_ROMAN (simple decimal sequence)
        const bulletPreset =
          block.type === BlockType.BULLETS
            ? "BULLET_DISC_CIRCLE_SQUARE"
            : "NUMBERED_DECIMAL_ALPHA_ROMAN";
        requests.push({
          createParagraphBullets: {
            range: {
              startIndex,
              endIndex: startIndex + text.length,
            },
            bulletPreset,
          },
        });
        insertedLength = text.length;
        break;
      }

      case BlockType.HORIZONTAL_RULE: {
        // "insertHorizontalRule" does not exist in the REST API.
        // We simulate it by inserting a newline and applying a bottom border to it.

        // 1. Insert the newline that will hold the border
        requests.push({
          insertText: {
            location: { index: startIndex },
            text: "\n",
          },
        });

        // 2. Apply a border to the paragraph we just inserted
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: startIndex,
              endIndex: startIndex + 1,
            },
            paragraphStyle: {
              borderBottom: {
                color: {
                  color: {
                    // The extra 'color' nesting is required here
                    rgbColor: { red: 0.8, green: 0.8, blue: 0.8 }, // Light grey line
                  },
                },
                width: {
                  magnitude: 1,
                  unit: "PT",
                },
                dashStyle: "SOLID",
              },
            },
            fields: "borderBottom",
          },
        });

        insertedLength = 1;
        break;
      }

      case BlockType.SPACER: {
        const height = block.height || 12;
        const newlines = Math.max(1, Math.floor(height / 12));
        const text = "\n".repeat(newlines);
        requests.push({
          insertText: { location: { index: startIndex }, text },
        });
        insertedLength = text.length;
        break;
      }

      default:
        logger.warn({ blockType: block.type }, "Unknown block type");
        break;
    }

    return { requests, insertedLength };
  }

  /**
   * Share document with admin
   * @private
   */
  async shareDocumentWithAdmin(documentId) {
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
        "Failed to share document with admin"
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

  // Update document content with formatted blocks (for regeneration)
  async updateDocumentContent(documentId, formattedBlocks) {
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

          // Clear existing content first
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
              ],
            },
          });

          // Now add the formatted content using the same logic as createFormattedDocument
          // but without creating a new document
          const requests = [];
          let currentIndex = 1;

          for (const block of formattedBlocks) {
            switch (block.type) {
              case BlockType.PARAGRAPH:
                requests.push({
                  insertText: {
                    location: { index: currentIndex },
                    text: block.text + "\n\n",
                  },
                });
                currentIndex += block.text.length + 2;
                break;

              case BlockType.HEADING:
                requests.push({
                  insertText: {
                    location: { index: currentIndex },
                    text: block.text + "\n\n",
                  },
                });

                // Apply heading style
                requests.push({
                  updateParagraphStyle: {
                    range: {
                      startIndex: currentIndex,
                      endIndex: currentIndex + block.text.length,
                    },
                    paragraphStyle: {
                      namedStyleType: `HEADING_${block.level || 1}`,
                    },
                    fields: "namedStyleType",
                  },
                });

                if (block.style?.bold) {
                  requests.push({
                    updateTextStyle: {
                      range: {
                        startIndex: currentIndex,
                        endIndex: currentIndex + block.text.length,
                      },
                      textStyle: {
                        bold: true,
                      },
                      fields: "bold",
                    },
                  });
                }

                currentIndex += block.text.length + 2;
                break;

              case BlockType.STYLED:
                requests.push({
                  insertText: {
                    location: { index: currentIndex },
                    text: block.text + "\n\n",
                  },
                });

                if (block.style?.bold || block.style?.italic) {
                  const textStyle = {};
                  if (block.style.bold) textStyle.bold = true;
                  if (block.style.italic) textStyle.italic = true;

                  requests.push({
                    updateTextStyle: {
                      range: {
                        startIndex: currentIndex,
                        endIndex: currentIndex + block.text.length,
                      },
                      textStyle,
                      fields: Object.keys(textStyle).join(","),
                    },
                  });
                }

                currentIndex += block.text.length + 2;
                break;

              case BlockType.SPACER:
                // Add empty lines for spacing
                const spacerLines = Math.max(
                  1,
                  Math.floor((block.height || 12) / 12)
                );
                const spacerText = "\n".repeat(spacerLines);
                requests.push({
                  insertText: {
                    location: { index: currentIndex },
                    text: spacerText,
                  },
                });
                currentIndex += spacerText.length;
                break;

              case BlockType.BULLETS:
                for (const item of block.items) {
                  requests.push({
                    insertText: {
                      location: { index: currentIndex },
                      text: `• ${item}\n`,
                    },
                  });
                  currentIndex += item.length + 3;
                }
                requests.push({
                  insertText: {
                    location: { index: currentIndex },
                    text: "\n",
                  },
                });
                currentIndex += 1;
                break;

              case BlockType.NUMBERED:
                for (let i = 0; i < block.items.length; i++) {
                  const item = block.items[i];
                  requests.push({
                    insertText: {
                      location: { index: currentIndex },
                      text: `${i + 1}. ${item}\n`,
                    },
                  });
                  currentIndex += item.length + `${i + 1}. `.length + 1;
                }
                requests.push({
                  insertText: {
                    location: { index: currentIndex },
                    text: "\n",
                  },
                });
                currentIndex += 1;
                break;

              default:
                // Handle unknown block types as plain text
                if (block.text) {
                  requests.push({
                    insertText: {
                      location: { index: currentIndex },
                      text: block.text + "\n\n",
                    },
                  });
                  currentIndex += block.text.length + 2;
                }
                break;
            }
          }

          // Execute all requests in batches to avoid API limits
          const batchSize = 50;
          for (let i = 0; i < requests.length; i += batchSize) {
            const batch = requests.slice(i, i + batchSize);
            if (batch.length > 0) {
              await this.docs.documents.batchUpdate({
                documentId,
                requestBody: { requests: batch },
              });
            }
          }
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "updateDocumentContent",
        true,
        duration
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "updateDocumentContent",
        false,
        duration,
        error
      );
      throw new GoogleError("updateDocumentContent", error, { documentId });
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

  /**
   * Export Google Doc as PDF and save to Drive folder
   * @param {string} documentId - Google Doc ID to export
   * @param {string} pdfName - Name for the PDF file
   * @param {string} folderId - Optional folder ID to save PDF in
   * @returns {Promise<Object>} PDF file metadata
   */
  async exportDocumentAsPdf(documentId, pdfName, folderId = null) {
    const startTime = Date.now();

    try {
      // Verify authentication first
      await this.verifyAuthentication();

      // Validate inputs
      if (!documentId || typeof documentId !== "string") {
        throw new Error("Document ID is required and must be a string");
      }

      if (!pdfName || typeof pdfName !== "string") {
        throw new Error("PDF name is required and must be a string");
      }

      const result = await retry(
        async () => {
          logger.info(
            {
              documentId,
              pdfName,
              folderId,
            },
            "Starting PDF export from Google Doc"
          );

          // Step 1: Export the document as PDF
          const exportResponse = await this.drive.files.export({
            fileId: documentId,
            mimeType: "application/pdf",
          });

          if (!exportResponse.data) {
            throw new Error("No PDF data received from export");
          }

          // Handle different response data types (Buffer, Blob, or string)
          let pdfBuffer;
          let dataSize;

          if (exportResponse.data instanceof Buffer) {
            pdfBuffer = exportResponse.data;
            dataSize = pdfBuffer.length;
          } else if (typeof exportResponse.data === "string") {
            pdfBuffer = Buffer.from(exportResponse.data, "binary");
            dataSize = pdfBuffer.length;
          } else if (
            exportResponse.data.constructor.name === "Blob" ||
            exportResponse.data.stream
          ) {
            // Handle Blob response - convert to Buffer
            try {
              if (typeof exportResponse.data.arrayBuffer === "function") {
                const arrayBuffer = await exportResponse.data.arrayBuffer();
                pdfBuffer = Buffer.from(arrayBuffer);
                dataSize = pdfBuffer.length;
              } else if (typeof exportResponse.data.stream === "function") {
                // Handle readable stream
                const chunks = [];
                const stream = exportResponse.data.stream();
                const reader = stream.getReader();

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                }

                pdfBuffer = Buffer.concat(
                  chunks.map((chunk) => Buffer.from(chunk))
                );
                dataSize = pdfBuffer.length;
              } else {
                throw new Error(
                  "Unsupported Blob format - no arrayBuffer or stream method"
                );
              }
            } catch (blobError) {
              throw new Error(
                `Failed to convert Blob to Buffer: ${blobError.message}`
              );
            }
          } else {
            // Fallback: try to create buffer from the data
            try {
              pdfBuffer = Buffer.from(exportResponse.data);
              dataSize = pdfBuffer.length;
            } catch (bufferError) {
              throw new Error(
                `Unsupported data type for PDF export: ${typeof exportResponse.data}. Expected Buffer, string, or Blob.`
              );
            }
          }

          logger.info(
            {
              documentId,
              dataSize,
              dataType: exportResponse.data.constructor.name,
            },
            "PDF export completed, creating file in Drive"
          );

          // Step 2: Create PDF file in Google Drive
          let sanitizedName = pdfName.replace(/[<>:"/\\|?*]/g, "_").trim();
          if (!sanitizedName.toLowerCase().endsWith(".pdf")) {
            sanitizedName += ".pdf";
          }

          // Convert Buffer to readable stream for googleapis compatibility
          const pdfStream = new Readable({
            read() {
              this.push(pdfBuffer);
              this.push(null); // End the stream
            },
          });

          const createRequest = {
            requestBody: {
              name: sanitizedName,
              mimeType: "application/pdf",
            },
            media: {
              mimeType: "application/pdf",
              body: pdfStream,
            },
            fields:
              "id,name,webViewLink,webContentLink,size,createdTime,modifiedTime",
          };

          // Add to folder if specified
          if (folderId) {
            createRequest.requestBody.parents = [folderId];
          }

          const pdfFile = await this.drive.files.create(createRequest);

          if (!pdfFile.data || !pdfFile.data.id) {
            throw new Error("Failed to create PDF file - no file ID returned");
          }

          logger.info(
            {
              documentId,
              pdfFileId: pdfFile.data.id,
              pdfName: pdfFile.data.name,
              size: pdfFile.data.size,
              folderId,
            },
            "PDF file created successfully in Google Drive"
          );

          // Step 3: Share with admin if configured
          try {
            await this.shareDocumentWithAdmin(pdfFile.data.id);
          } catch (shareError) {
            // Log warning but don't fail the export
            logger.warn(
              {
                pdfFileId: pdfFile.data.id,
                error: shareError.message,
              },
              "Failed to share PDF with admin, but export completed successfully"
            );
          }

          return {
            id: pdfFile.data.id,
            name: pdfFile.data.name,
            webViewLink: pdfFile.data.webViewLink,
            webContentLink: pdfFile.data.webContentLink,
            size: pdfFile.data.size,
            createdTime: pdfFile.data.createdTime,
            modifiedTime: pdfFile.data.modifiedTime,
            mimeType: "application/pdf",
            originalDocumentId: documentId,
          };
        },
        3, // max attempts
        2000 // base delay - PDF export can be slower
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "exportDocumentAsPdf",
        true,
        duration
      );

      logger.info(
        {
          documentId,
          pdfFileId: result.id,
          pdfName: result.name,
          duration,
        },
        "PDF export and creation completed successfully"
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Google Drive",
        "exportDocumentAsPdf",
        false,
        duration,
        error
      );

      logger.error(
        {
          documentId,
          pdfName,
          error: error.message,
          duration,
        },
        "PDF export failed"
      );

      // Enhance error message based on error type
      let enhancedMessage = error.message;
      if (error.code === 403) {
        enhancedMessage = `Permission denied: Service account '${appConfig.google.clientEmail}' lacks permission to export document or create files. Ensure the service account has Editor role and APIs are enabled.`;
      } else if (error.code === 404) {
        enhancedMessage = `Document not found: Document ID '${documentId}' does not exist or is not accessible for PDF export.`;
      } else if (error.code === 429) {
        enhancedMessage =
          "Rate limit exceeded: Too many requests to Google API. Retry after delay.";
      }

      throw new GoogleError("exportDocumentAsPdf", new Error(enhancedMessage), {
        documentId,
        pdfName,
        folderId,
        originalError: error.message,
        code: error.code,
        serviceAccount: appConfig.google.clientEmail,
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
  async shareDocument(documentId, recipients) {
    const startTime = Date.now();

    try {
      // Verify authentication first
      await this.verifyAuthentication();

      // Validate document ID
      if (!documentId || typeof documentId !== "string") {
        throw new Error("Document ID is required and must be a string");
      }

      // Validate recipients array
      if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error("Recipients must be a non-empty array");
      }

      const validRoles = ["reader", "commenter", "writer", "owner"];
      const validatedRecipients = [];
      const skippedRecipients = [];

      // Validate each recipient
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];

        try {
          // Validate recipient object structure
          if (!recipient || typeof recipient !== "object") {
            throw new Error("Recipient must be an object");
          }

          // Validate email
          if (
            !recipient.email ||
            typeof recipient.email !== "string" ||
            !recipient.email.includes("@")
          ) {
            throw new Error("Valid email address is required");
          }

          // Validate role (default to "reader" if not provided)
          const role = recipient.role || "reader";
          if (!validRoles.includes(role)) {
            throw new Error(
              `Invalid role. Must be one of: ${validRoles.join(", ")}`
            );
          }

          // Validate options (default to empty object if not provided)
          const options = recipient.options || {};
          if (typeof options !== "object") {
            throw new Error("Options must be an object");
          }

          // Extract and validate options
          const { sendNotification = false, expirationTime = null } = options;

          if (typeof sendNotification !== "boolean") {
            throw new Error("sendNotification must be a boolean");
          }

          if (expirationTime !== null && typeof expirationTime !== "string") {
            throw new Error("expirationTime must be a string or null");
          }

          // Add to validated recipients
          validatedRecipients.push({
            email: recipient.email.trim().toLowerCase(),
            role,
            options: { sendNotification, expirationTime },
          });
        } catch (validationError) {
          // Log warning and skip invalid recipient
          logger.warn(
            {
              documentId,
              recipientIndex: i,
              recipient: recipient,
              error: validationError.message,
            },
            "Skipping invalid recipient during document sharing"
          );

          skippedRecipients.push({
            index: i,
            recipient,
            error: validationError.message,
          });
        }
      }

      // Check if we have any valid recipients after validation
      if (validatedRecipients.length === 0) {
        throw new Error("No valid recipients found after validation");
      }

      // Log validation summary
      logger.info(
        {
          documentId,
          totalRecipients: recipients.length,
          validRecipients: validatedRecipients.length,
          skippedRecipients: skippedRecipients.length,
        },
        "Recipient validation completed"
      );

      // Share document with each valid recipient
      const shareResults = [];
      const shareErrors = [];

      for (const recipient of validatedRecipients) {
        try {
          await retry(
            async () => {
              const permissionRequest = {
                fileId: documentId,
                requestBody: {
                  role: recipient.role,
                  type: "user",
                  emailAddress: recipient.email,
                },
                sendNotificationEmail: recipient.options.sendNotification,
              };

              // Add expiration time if specified
              if (recipient.options.expirationTime) {
                permissionRequest.requestBody.expirationTime =
                  recipient.options.expirationTime;
              }

              const result = await this.drive.permissions.create(
                permissionRequest
              );

              logger.info(
                {
                  documentId,
                  email: recipient.email,
                  role: recipient.role,
                  permissionId: result.data.id,
                },
                "Document shared successfully with recipient"
              );

              shareResults.push({
                email: recipient.email,
                role: recipient.role,
                permissionId: result.data.id,
                success: true,
              });

              return result;
            },
            3,
            1000
          );
        } catch (shareError) {
          // Log error but continue with other recipients
          logger.error(
            {
              documentId,
              email: recipient.email,
              role: recipient.role,
              error: shareError.message,
              code: shareError.code,
            },
            "Failed to share document with recipient"
          );

          shareErrors.push({
            email: recipient.email,
            role: recipient.role,
            error: shareError.message,
            code: shareError.code,
          });
        }
      }

      const duration = Date.now() - startTime;

      // Determine overall success - at least one recipient must succeed
      const overallSuccess = shareResults.length > 0;

      logIntegrationCall(
        logger,
        "Google Drive",
        "shareDocument",
        overallSuccess,
        duration
      );

      // Log final summary
      logger.info(
        {
          documentId,
          totalRecipients: recipients.length,
          successfulShares: shareResults.length,
          failedShares: shareErrors.length,
          skippedRecipients: skippedRecipients.length,
          duration,
        },
        "Document sharing operation completed"
      );

      // Return comprehensive results
      return {
        documentId,
        totalRecipients: recipients.length,
        successfulShares: shareResults,
        failedShares: shareErrors,
        skippedRecipients,
        overallSuccess,
      };
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
        recipients,
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
      logger.error(
        {
          error: error.message,
          errors: error?.errors,
          responseError: error?.response?.data?.error,
          requestData: error?.response?.config?.data,
          stack: error.stack,
        },
        "Google API error details"
      );
    }

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
   * Upload a file from buffer to Google Drive
   * @param {Buffer} buffer - File buffer
   * @param {string} fileName - Name for the uploaded file
   * @param {string} mimeType - MIME type of the file
   * @param {string} folderId - Optional folder ID to upload to
   * @returns {Promise<Object>} Uploaded file metadata
   */
  async uploadFileFromBuffer(buffer, fileName, mimeType, folderId = null) {
    const startTime = Date.now();

    try {
      const { Readable } = require("stream");

      // Create a readable stream from buffer
      const bufferStream = Readable.from(buffer);

      const fileMetadata = {
        name: fileName,
        parents: folderId ? [folderId] : undefined,
      };

      const media = {
        mimeType,
        body: bufferStream,
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id,name,webViewLink,webContentLink,size,mimeType",
      });

      const duration = Date.now() - startTime;

      logger.info(
        {
          fileId: response.data.id,
          fileName: response.data.name,
          size: response.data.size,
          mimeType: response.data.mimeType,
          duration,
        },
        "File uploaded from buffer successfully"
      );

      return {
        id: response.data.id,
        name: response.data.name,
        webViewLink: response.data.webViewLink,
        webContentLink: response.data.webContentLink,
        size: parseInt(response.data.size || "0", 10),
        mimeType: response.data.mimeType,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          fileName,
          mimeType,
          bufferSize: buffer?.length,
          error: error.message,
          duration,
        },
        "Failed to upload file from buffer"
      );

      throw new GoogleError("uploadFileFromBuffer", error, {
        fileName,
        mimeType,
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
            const recipients = [
              {
                email: appConfig.server.adminEmail,
                role: "writer",
              },
              // TODO: Remove this after testing
              {
                email: "okohfavour91@gmail.com",
                role: "writer",
              },
            ];

            const shareResult = await this.shareDocument(folder.id, recipients);

            logger.info(
              {
                folderId: folder.id,
                successfulShares: shareResult.successfulShares.length,
                failedShares: shareResult.failedShares.length,
              },
              "Documents folder sharing completed"
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
