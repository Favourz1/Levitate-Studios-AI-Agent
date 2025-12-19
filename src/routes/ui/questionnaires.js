const express = require("express");
const router = express.Router();
const { asyncHandler } = require("@/middleware/errorHandler");
const { sendSuccessResponse } = require("@/middleware/errorHandler");
const { StatusCodes } = require("http-status-codes");
const { getPrismaClient } = require("@/database");
const { requireAuthForUI } = require("@/middleware/auth");
const { requirePermission } = require("@/utils/permissions");
const { divideAndRoundUp } = require("@/utils/pagination");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/questionnaires
 * List questionnaire responses
 */
router.get(
  "/",
  requireAuthForUI,
  requirePermission("questionnaires", "view"),
  asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 20,
      projectId,
      processingStatus,
      search,
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // For counting total, we need to do complex filter if search applies to relations.
    let where = {
      ...(projectId && { projectId: parseInt(projectId, 10) }),
      ...(processingStatus && { processingStatus }),
    };

    // Build OR array if search is provided (for respondentEmail, responseId, formId, project.name, client.name)
    let searchOR = [];
    if (search) {
      searchOR = [
        { respondentEmail: { contains: search, mode: "insensitive" } },
        { responseId: { contains: search } },
        { formId: { contains: search } },
        { project: { name: { contains: search, mode: "insensitive" } } },
        {
          project: {
            client: { name: { contains: search, mode: "insensitive" } },
          },
        },
      ];
    }

    // For count: use _count with _or in relation paths
    // See https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#filtering-by-relational-fields

    // If search, build where with OR; else just use plain where
    const whereForPrisma =
      searchOR.length > 0 ? { ...where, OR: searchOR } : where;

    const total = await prisma.questionnaireResponse.count({
      where: whereForPrisma,
    });

    const responses = await prisma.questionnaireResponse.findMany({
      where: whereForPrisma,
      include: {
        project: {
          include: {
            client: true,
          },
        },
      },
      orderBy: { submittedAt: "desc" },
      skip: offset,
      take: limitNum,
    });

    const totalPages = divideAndRoundUp(total, limitNum);

    return sendSuccessResponse(
      res,
      {
        responses,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      },
      "Questionnaire responses retrieved successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
