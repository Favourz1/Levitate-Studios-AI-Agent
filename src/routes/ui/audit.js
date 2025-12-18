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
 * GET /api/v1/ui/audit
 * List audit logs with filters and pagination
 */
router.get(
  "/",
  requireAuthForUI,
  requirePermission("audit", "view"),
  asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 50,
      projectId,
      actor,
      actingRole,
      action,
      startDate,
      endDate,
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // For actor, also check details?.name (stored in JSON in details column)
    let actorFilter = undefined;
    if (actor) {
      actorFilter = {
        OR: [
          { actor: { contains: actor, mode: "insensitive" } },
          // details.name string in Prisma JSON (Postgres) field
          {
            details: {
              path: ["name"],
              string_contains: actor,
              mode: "insensitive",
            },
          },
        ],
      };
    }

    const where = {
      ...(projectId && { projectId: parseInt(projectId, 10) }),
      ...(actorFilter && actorFilter),
      ...(actingRole && { actingRole: { equals: actingRole } }),
      ...(action && { action: { contains: action, mode: "insensitive" } }),
      ...((startDate || endDate) && {
        at: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      }),
    };

    const total = await prisma.auditLog.count({ where });

    const logs = await prisma.auditLog.findMany({
      where,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            phase: true,
          },
        },
      },
      orderBy: { at: "desc" },
      skip: offset,
      take: limitNum,
    });

    const totalPages = divideAndRoundUp(total, limitNum);

    return sendSuccessResponse(
      res,
      {
        logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      },
      "Audit logs retrieved successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
