const { getPrismaClient } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { DocumentType } = require("@/constants");

const logger = createLogger("service:workplan");
const prisma = getPrismaClient();

/**
 * Workplan Service
 * Helper functions for fetching and updating workplan documents and slides.
 */
class WorkplanService {
  /**
   * Get the workplan document for a project.
   * Returns the most recently created workplan if multiple exist.
   * @param {number} projectId
   * @returns {Promise<Object|null>}
   */
  static async getWorkplanByProjectId(projectId) {
    try {
      const normalizedProjectId = Number(projectId);
      if (!Number.isInteger(normalizedProjectId)) {
        throw new Error("projectId is required and must be an integer");
      }

      logger.debug(
        { projectId: normalizedProjectId },
        "Fetching workplan by projectId"
      );

      const workplan = await prisma.document.findFirst({
        where: {
          projectId: normalizedProjectId,
          type: DocumentType.WORKPLAN,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (!workplan) {
        logger.info(
          { projectId: normalizedProjectId },
          "No workplan document found for project"
        );
      }

      return workplan;
    } catch (error) {
      logger.error(
        { projectId, error: error.message, stack: error.stack },
        "Failed to fetch workplan by projectId"
      );
      throw error;
    }
  }

  /**
   * Get all slides for a workplan document ordered by slideNumber.
   * @param {number} documentId
   * @returns {Promise<Array>}
   */
  static async getWorkplanSlides(documentId) {
    try {
      const normalizedDocumentId = Number(documentId);
      if (!Number.isInteger(normalizedDocumentId)) {
        throw new Error("documentId is required and must be an integer");
      }

      logger.debug(
        { documentId: normalizedDocumentId },
        "Fetching workplan slides for document"
      );

      return await prisma.workplanSlide.findMany({
        where: {
          documentId: normalizedDocumentId,
        },
        orderBy: {
          slideNumber: "asc",
        },
      });
    } catch (error) {
      logger.error(
        { documentId, error: error.message, stack: error.stack },
        "Failed to fetch workplan slides"
      );
      throw error;
    }
  }

  /**
   * Get a single slide by id with its parent document relation.
   * @param {number} slideId
   * @returns {Promise<Object|null>}
   */
  static async getSlideById(slideId) {
    try {
      const normalizedSlideId = Number(slideId);
      if (!Number.isInteger(normalizedSlideId)) {
        throw new Error("slideId is required and must be an integer");
      }

      logger.debug(
        { slideId: normalizedSlideId },
        "Fetching workplan slide by id"
      );

      return await prisma.workplanSlide.findUnique({
        where: { id: normalizedSlideId },
        include: {
          document: true,
        },
      });
    } catch (error) {
      logger.error(
        { slideId, error: error.message, stack: error.stack },
        "Failed to fetch workplan slide by id"
      );
      throw error;
    }
  }

  /**
   * Update slide status fields (researchStatus, contentStatus, designStatus).
   * Only provided fields are updated.
   * @param {number} slideId
   * @param {Object} statusFields
   * @returns {Promise<Object>}
   */
  static async updateSlideStatus(slideId, statusFields = {}) {
    try {
      const normalizedSlideId = Number(slideId);
      if (!Number.isInteger(normalizedSlideId)) {
        throw new Error("slideId is required and must be an integer");
      }

      const allowedFields = ["researchStatus", "contentStatus", "designStatus"];
      const data = {};

      allowedFields.forEach((key) => {
        if (statusFields[key] !== undefined) {
          data[key] = statusFields[key];
        }
      });

      if (Object.keys(data).length === 0) {
        throw new Error(
          "At least one status field is required: researchStatus, contentStatus, designStatus"
        );
      }

      logger.debug(
        { slideId: normalizedSlideId, data },
        "Updating workplan slide status fields"
      );

      return await prisma.workplanSlide.update({
        where: { id: normalizedSlideId },
        data,
      });
    } catch (error) {
      logger.error(
        { slideId, error: error.message, stack: error.stack },
        "Failed to update workplan slide status"
      );
      throw error;
    }
  }

  /**
   * Get the current status of a workplan document.
   * @param {number} documentId
   * @returns {Promise<string|null>}
   */
  static async getWorkplanStatus(documentId) {
    try {
      const normalizedDocumentId = Number(documentId);
      if (!Number.isInteger(normalizedDocumentId)) {
        throw new Error("documentId is required and must be an integer");
      }

      logger.debug(
        { documentId: normalizedDocumentId },
        "Fetching workplan document status"
      );

      const workplan = await prisma.document.findFirst({
        where: {
          id: normalizedDocumentId,
          type: DocumentType.WORKPLAN,
        },
        select: {
          status: true,
        },
      });

      if (!workplan) {
        logger.info(
          { documentId: normalizedDocumentId },
          "Workplan document not found while fetching status"
        );
        return null;
      }

      return workplan.status;
    } catch (error) {
      logger.error(
        { documentId, error: error.message, stack: error.stack },
        "Failed to fetch workplan status"
      );
      throw error;
    }
  }
}

module.exports = { WorkplanService };
