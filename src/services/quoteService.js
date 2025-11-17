const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const {
  ValidationError,
  IntegrationError,
  LLMError,
  BaseError,
} = require("@/utils/errors");
const { llmClient } = require("@/llm/client");
const { QuotePromptService } = require("@/services/quotePromptService");
const { erpIntegration } = require("@/integrations/levitateStudiosErp");
const { googleIntegration } = require("@/integrations/google");
const { getConfig, CONFIG_KEYS } = require("@/utils/globalConfig");
const { DocumentType } = require("@/constants");

const logger = createLogger("service:quote");
const prisma = getPrismaClient();

/**
 * QuoteService handles quote generation business logic
 * Coordinates LLM, ERP, and Google Drive integrations
 */
class QuoteService {
  /**
   * Assemble complete context for quote generation
   * @param {number} projectId - Project ID
   * @returns {Promise<Object>} Complete context object
   */
  static async assembleQuoteContext(projectId) {
    try {
      if (!projectId || typeof projectId !== "number") {
        throw new ValidationError(
          "Project ID is required and must be a number"
        );
      }

      logger.info({ projectId }, "Assembling quote context");

      // Get project with all related data
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
          questionnaireResponses: {
            where: {
              processingStatus: "PROCESSED",
            },
            orderBy: {
              submittedAt: "desc",
            },
            take: 1,
          },
          documents: {
            where: {
              type: DocumentType.BRAND_ORIGIN,
              status: "ACCEPTED",
            },
            include: {
              currentRevision: true,
            },
            orderBy: {
              updatedAt: "desc",
            },
            take: 1,
          },
        },
      });

      if (!project) {
        throw new ValidationError(`Project not found: ${projectId}`);
      }

      // Get rate card from global configs
      const rateCard = await getConfig(CONFIG_KEYS.RATE_CARD);
      if (!rateCard) {
        logger.warn(
          { projectId },
          "Rate card not found in global configs - quote generation may be limited"
        );
      }

      // Get questionnaire data
      const questionnaireData =
        project.questionnaireResponses.length > 0
          ? project.questionnaireResponses[0]
          : null;

      if (!questionnaireData) {
        throw new ValidationError(
          `No processed questionnaire found for project ${projectId}`
        );
      }

      // Get brand origin document
      const brandOriginDocument =
        project.documents.length > 0 ? project.documents[0] : null;

      let brandOriginData = null;
      if (brandOriginDocument && brandOriginDocument.currentRevision) {
        brandOriginData = {
          id: brandOriginDocument.id,
          snapshotText: brandOriginDocument.currentRevision.snapshotText,
          driveFileId: brandOriginDocument.driveFileId,
        };
      }

      const context = {
        project: {
          id: project.id,
          name: project.name,
          phase: project.phase,
          client: {
            id: project.client.id,
            name: project.client.name,
            primaryEmail: project.client.primaryEmail,
            context: project.client.context,
          },
        },
        questionnaire: {
          id: questionnaireData.id,
          responses: questionnaireData.responses,
          submittedAt: questionnaireData.submittedAt,
        },
        brandOrigin: brandOriginData,
        rateCard: rateCard,
      };

      logger.info(
        {
          projectId,
          hasQuestionnaire: !!questionnaireData,
          hasBrandOrigin: !!brandOriginData,
          hasRateCard: !!rateCard,
        },
        "Quote context assembled successfully"
      );

      return context;
    } catch (error) {
      logger.error(
        {
          projectId,
          error: error.message,
          errorType: error.constructor.name,
        },
        "Failed to assemble quote context"
      );
      throw error;
    }
  }

  /**
   * Map project services to rate card items using fuzzy matching
   * @param {Array} requirements - Project requirements/services
   * @param {Object} rateCard - Rate card data
   * @returns {Promise<Array>} Mapped rate card items
   */
  static async mapServicesToRateCard(requirements, rateCard) {
    try {
      if (!rateCard || !rateCard.sections) {
        logger.warn("Rate card not available for mapping");
        return [];
      }

      // Extract all rate card items
      const rateCardItems = [];
      rateCard.sections.forEach((section) => {
        if (section.items && Array.isArray(section.items)) {
          section.items.forEach((item) => {
            rateCardItems.push({
              ...item,
              category: section.category,
            });
          });
        }
      });

      // TODO: Simple fuzzy matching - in production, this could be enhanced with LLM
      const mapped = [];
      if (Array.isArray(requirements)) {
        requirements.forEach((requirement) => {
          const reqLower = requirement.toLowerCase();
          const match = rateCardItems.find((item) => {
            const itemLower = item.item.toLowerCase();
            return (
              itemLower.includes(reqLower) ||
              reqLower.includes(itemLower) ||
              this.calculateSimilarity(reqLower, itemLower) > 0.6
            );
          });

          if (match) {
            mapped.push({
              requirement,
              rateCardItem: match,
              matchScore: match
                ? this.calculateSimilarity(reqLower, match.item.toLowerCase())
                : 0,
            });
          }
        });
      }

      return mapped;
    } catch (error) {
      logger.error(
        { error: error.message },
        "Failed to map services to rate card"
      );
      throw error;
    }
  }

  /**
   * Calculate string similarity (simple Jaccard similarity)
   * @private
   */
  static calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));
    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
  }

  /**
   * Generate quote items using LLM
   * @param {Object} context - Complete quote context
   * @returns {Promise<Array>} Generated quote items
   */
  static async generateQuoteItemsWithLLM(context) {
    try {
      logger.info(
        {
          projectId: context.project.id,
          clientName: context.project.client.name,
        },
        "Starting LLM quote generation"
      );

      // Generate LLM context using prompt service
      const llmContext = QuotePromptService.generateLLMContext(
        context.project,
        context.questionnaire,
        context.brandOrigin,
        context.rateCard
      );

      // Get quote items schema
      const quoteItemsSchema = QuotePromptService.generateQuoteItemsSchema();

      // Generate quote items using structured output
      const result = await llmClient.generateStructured(
        quoteItemsSchema,
        llmContext.userPrompt,
        {
          systemPrompt: llmContext.systemPrompt,
          projectId: context.project.id,
          clientName: context.project.client.name,
        },
        "generation"
      );

      if (
        !result.data ||
        !Array.isArray(result.data) ||
        result.data.length === 0
      ) {
        throw new LLMError(
          "quote-generation",
          "generateQuoteItemsWithLLM",
          new Error("LLM returned empty or invalid quote items"),
          {
            projectId: context.project.id,
            traceId: result.traceId,
          }
        );
      }

      logger.info(
        {
          projectId: context.project.id,
          itemCount: result.data.length,
          traceId: result.traceId,
        },
        "LLM quote generation completed successfully"
      );

      return result.data;
    } catch (error) {
      logger.error(
        {
          projectId: context.project.id,
          error: error.message,
          errorType: error.constructor.name,
        },
        "Failed to generate quote items with LLM"
      );

      if (error instanceof LLMError) {
        throw error;
      }

      throw new LLMError(
        "quote-generation",
        "generateQuoteItemsWithLLM",
        error,
        {
          projectId: context.project.id,
        }
      );
    }
  }

  /**
   * Ensure customer exists in ERP system
   * Searches for customer by exact name, creates if not found
   * @param {Object} client - Client data
   * @returns {Promise<string>} Customer name (primary key) to use in quotes
   */
  static async ensureCustomerExists(client) {
    try {
      if (!client || !client.name) {
        throw new ValidationError("Client name is required");
      }

      logger.info(
        { clientName: client.name, clientEmail: client.primaryEmail },
        "Ensuring customer exists in ERP"
      );

      // Use ERP integration to search or create customer
      const customerName = await erpIntegration.searchOrCreateCustomer(
        client.name,
        client.primaryEmail
      );

      logger.info(
        { clientName: client.name, customerName },
        "Customer ensured in ERP system"
      );

      return customerName;
    } catch (error) {
      logger.error(
        {
          clientName: client.name,
          error: error.message,
        },
        "Failed to ensure customer exists"
      );

      if (error instanceof IntegrationError) {
        throw error;
      }

      throw new IntegrationError("ERP", "ensureCustomerExists", error, {
        clientName: client.name,
      });
    }
  }

  /**
   * Ensure all items exist in ERP system
   * Searches for each item, creates if not found
   * @param {Array} quoteItems - Quote items with item_code, description
   * @returns {Promise<Array>} Validated quote items with confirmed item codes
   */
  static async ensureItemsExist(quoteItems) {
    try {
      if (!Array.isArray(quoteItems) || quoteItems.length === 0) {
        throw new ValidationError(
          "Quote items array is required and must not be empty"
        );
      }

      logger.info(
        { itemCount: quoteItems.length },
        "Ensuring all items exist in ERP"
      );

      const validatedItems = [];

      for (const item of quoteItems) {
        if (!item.item_code) {
          throw new ValidationError(
            `Quote item missing item_code: ${JSON.stringify(item)}`
          );
        }

        if (!item.description) {
          throw new ValidationError(
            `Quote item missing description: ${JSON.stringify(item)}`
          );
        }

        // Search or create item in ERP
        const validatedItemCode = await erpIntegration.searchOrCreateItem(
          item.item_code,
          item.description,
          "Nos" // Default stock UOM
        );

        validatedItems.push({
          ...item,
          item_code: validatedItemCode, // Use validated item code
        });

        logger.debug(
          {
            originalItemCode: item.item_code,
            validatedItemCode,
          },
          "Item validated in ERP"
        );
      }

      logger.info(
        {
          originalCount: quoteItems.length,
          validatedCount: validatedItems.length,
        },
        "All items ensured in ERP system"
      );

      return validatedItems;
    } catch (error) {
      logger.error(
        {
          itemCount: quoteItems?.length,
          error: error.message,
        },
        "Failed to ensure items exist"
      );

      if (
        error instanceof IntegrationError ||
        error instanceof ValidationError
      ) {
        throw error;
      }

      throw new IntegrationError("ERP", "ensureItemsExist", error, {
        itemCount: quoteItems?.length,
      });
    }
  }

  /**
   * Create quotes via ERP API (main + 3 variants)
   * @param {Array} quoteItems - Validated quote items
   * @param {string} customerName - Customer name (primary key)
   * @param {Object} project - Project data
   * @returns {Promise<Object>} Quote IDs: { mainQuoteId, variantIds: [id1, id2, id3] }
   */
  static async createQuotesViaERP(quoteItems, customerName, project) {
    try {
      if (!Array.isArray(quoteItems) || quoteItems.length === 0) {
        throw new ValidationError("Quote items array is required");
      }

      if (!customerName || typeof customerName !== "string") {
        throw new ValidationError("Customer name is required");
      }

      logger.info(
        {
          customerName,
          itemCount: quoteItems.length,
          projectId: project.id,
        },
        "Creating quotes via ERP API"
      );

      // Prepare base quote data
      const today = new Date().toISOString().split("T")[0];
      const validTill = new Date();
      validTill.setMonth(validTill.getMonth() + 3); // 3 months validity
      const validTillStr = validTill.toISOString().split("T")[0];

      const baseQuoteData = {
        customer: customerName,
        items: quoteItems.map((item) => ({
          item_code: item.item_code,
          qty: item.qty || 1,
          rate: item.rate,
          description: item.description,
        })),
        transaction_date: today,
        valid_till: validTillStr,
        order_type: "Sales",
        taxes_and_charges: "Nigeria Tax - L",
      };

      // Create main quote
      logger.info({ customerName }, "Creating main quote");
      const mainQuote = await erpIntegration.createQuotation(baseQuoteData);
      const mainQuoteId = mainQuote.quoteId || mainQuote.name;

      if (!mainQuoteId) {
        throw new Error("Main quote creation failed - no quote ID returned");
      }

      logger.info(
        { mainQuoteId, customerName },
        "Main quote created successfully"
      );

      // Generate variant quote items using LLM
      const variantIds = [];
      //   TODO: You can reduce number of generated quote variants here.
      for (let i = 1; i <= 3; i++) {
        try {
          logger.info(
            { variantIndex: i, customerName },
            `Generating variant ${i} quote items`
          );

          // Generate variant prompt
          const variantPrompt = QuotePromptService.generateVariantPrompt(
            quoteItems,
            i,
            {
              questionnaire: {
                raw: project.questionnaire?.responses || {},
              },
              rateCard: project.rateCard,
            }
          );

          // Generate variant items using LLM
          const variantSchema = QuotePromptService.generateQuoteItemsSchema();
          const variantResult = await llmClient.generateStructured(
            variantSchema,
            variantPrompt,
            {
              systemPrompt: QuotePromptService.generateSystemPrompt({
                project: project.project,
              }),
            },
            "generation"
          );

          let variantItems;
          if (
            !variantResult.data ||
            !Array.isArray(variantResult.data) ||
            variantResult.data.length === 0
          ) {
            logger.warn(
              { variantIndex: i },
              "Variant LLM generation returned empty - using base quote items"
            );
            // Fallback to base items if variant generation fails
            variantItems = quoteItems;
          } else {
            variantItems = variantResult.data;
          }

          // Ensure variant items exist in ERP
          const validatedVariantItems = await this.ensureItemsExist(
            variantItems
          );

          // Create variant quote
          const variantQuoteData = {
            ...baseQuoteData,
            items: validatedVariantItems.map((item) => ({
              item_code: item.item_code,
              qty: item.qty || 1,
              rate: item.rate,
              description: item.description,
            })),
          };

          const variantQuote = await erpIntegration.createQuotation(
            variantQuoteData
          );
          const variantQuoteId = variantQuote.quoteId || variantQuote.name;

          if (!variantQuoteId) {
            throw new Error(
              `Variant ${i} quote creation failed - no quote ID returned`
            );
          }

          variantIds.push(variantQuoteId);

          logger.info(
            { variantIndex: i, variantQuoteId, customerName },
            `Variant ${i} quote created successfully`
          );
        } catch (variantError) {
          logger.error(
            {
              variantIndex: i,
              error: variantError.message,
            },
            `Failed to create variant ${i} quote`
          );
          // Continue with other variants even if one fails
          // Add null to maintain array length
          variantIds.push(null);
        }
      }

      // Filter out null variants (failed creations)
      const validVariantIds = variantIds.filter((id) => id !== null);

      logger.info(
        {
          mainQuoteId,
          variantCount: validVariantIds.length,
          customerName,
        },
        "All quotes created via ERP API"
      );

      return {
        mainQuoteId,
        variantIds: validVariantIds,
      };
    } catch (error) {
      logger.error(
        {
          customerName,
          itemCount: quoteItems.length,
          error: error.message,
        },
        "Failed to create quotes via ERP"
      );

      if (error instanceof IntegrationError) {
        throw error;
      }

      throw new IntegrationError("ERP", "createQuotesViaERP", error, {
        customerName,
        itemCount: quoteItems.length,
      });
    }
  }

  /**
   * Download PDFs for all quotes
   * @param {Array} quoteIds - Array of quote IDs [main, variant1, variant2, variant3]
   * @returns {Promise<Array>} Array of PDF buffers with metadata
   */
  static async downloadQuotePDFs(quoteIds) {
    try {
      if (!Array.isArray(quoteIds) || quoteIds.length === 0) {
        throw new ValidationError("Quote IDs array is required");
      }

      logger.info(
        { quoteCount: quoteIds.length },
        "Downloading quote PDFs from ERP"
      );

      const pdfs = [];

      for (const quoteId of quoteIds) {
        if (!quoteId) {
          logger.warn({ quoteId }, "Skipping null quote ID");
          pdfs.push(null);
          continue;
        }

        try {
          // Verify quote is not cancelled before downloading
          const quoteDetails = await erpIntegration.getQuotation(quoteId);
          if (quoteDetails.quotation_canceled) {
            logger.warn(
              { quoteId, latestCanceledId: quoteDetails.latest_canceled_id },
              "Quote is cancelled - skipping PDF download"
            );
            pdfs.push(null);
            continue;
          }

          // Download PDF
          const pdfBuffer = await erpIntegration.getQuotationPDF(quoteId);

          if (!Buffer.isBuffer(pdfBuffer)) {
            throw new Error("PDF download did not return a buffer");
          }

          pdfs.push({
            quoteId,
            pdfBuffer,
            size: pdfBuffer.length,
            fileName: `Quote_${quoteId}.pdf`,
          });

          logger.info(
            { quoteId, pdfSize: pdfBuffer.length },
            "Quote PDF downloaded successfully"
          );
        } catch (pdfError) {
          logger.error(
            {
              quoteId,
              error: pdfError.message,
            },
            "Failed to download quote PDF"
          );
          // Continue with other PDFs even if one fails
          pdfs.push(null);
        }
      }

      const successfulDownloads = pdfs.filter((pdf) => pdf !== null).length;

      logger.info(
        {
          totalQuotes: quoteIds.length,
          successfulDownloads,
        },
        "Quote PDF download completed"
      );

      return pdfs;
    } catch (error) {
      logger.error(
        {
          quoteCount: quoteIds?.length,
          error: error.message,
        },
        "Failed to download quote PDFs"
      );
      throw error;
    }
  }

  /**
   * Upload quote PDFs to Google Drive
   * @param {Array} pdfs - Array of PDF objects with quoteId, pdfBuffer, fileName
   * @param {Object} project - Project data
   * @returns {Promise<Array>} Array of Drive file IDs
   */
  static async uploadQuotePDFsToDrive(pdfs, project) {
    try {
      if (!Array.isArray(pdfs) || pdfs.length === 0) {
        throw new ValidationError("PDFs array is required");
      }

      logger.info(
        { pdfCount: pdfs.length, projectId: project.id },
        "Uploading quote PDFs to Google Drive"
      );

      // Get or create documents folder
      const documentsFolder = await googleIntegration.ensureDocumentsFolder();

      const driveFiles = [];

      for (const pdf of pdfs) {
        if (!pdf || !pdf.pdfBuffer) {
          logger.warn({ pdf }, "Skipping invalid PDF object");
          driveFiles.push(null);
          continue;
        }

        try {
          // Generate file name
          const fileName = pdf.fileName || `Quote_${pdf.quoteId}.pdf`;

          // Upload PDF to Drive
          const driveFile = await googleIntegration.uploadFileFromBuffer(
            pdf.pdfBuffer,
            fileName,
            "application/pdf",
            documentsFolder.id
          );

          driveFiles.push({
            quoteId: pdf.quoteId,
            driveFileId: driveFile.id,
            driveFileName: driveFile.name,
            webViewLink: driveFile.webViewLink,
            webContentLink: driveFile.webContentLink,
            size: driveFile.size,
          });

          logger.info(
            {
              quoteId: pdf.quoteId,
              driveFileId: driveFile.id,
              fileName: driveFile.name,
            },
            "Quote PDF uploaded to Drive successfully"
          );
        } catch (uploadError) {
          logger.error(
            {
              quoteId: pdf.quoteId,
              error: uploadError.message,
            },
            "Failed to upload quote PDF to Drive"
          );
          // Continue with other PDFs even if one fails
          driveFiles.push(null);
        }
      }

      const successfulUploads = driveFiles.filter(
        (file) => file !== null
      ).length;

      logger.info(
        {
          totalPDFs: pdfs.length,
          successfulUploads,
        },
        "Quote PDF upload to Drive completed"
      );

      return driveFiles;
    } catch (error) {
      logger.error(
        {
          pdfCount: pdfs?.length,
          error: error.message,
        },
        "Failed to upload quote PDFs to Drive"
      );
      throw error;
    }
  }
}

module.exports = {
  QuoteService,
};
