const express = require("express");
const router = express.Router();
const { asyncHandler } = require("@/middleware/errorHandler");
const { sendSuccessResponse } = require("@/middleware/errorHandler");
const { StatusCodes } = require("http-status-codes");
const { getPrismaClient } = require("@/database");
const { requireAuthForUI } = require("@/middleware/auth");
const { requirePermission } = require("@/utils/permissions");
const { divideAndRoundUp } = require("@/utils/pagination");
const { Prisma } = require("@prisma/client");

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

    let total, logs;

    // If actor filter is needed, use raw SQL for case-insensitive JSON search
    if (actor && actor.trim()) {
      const actorLower = actor.trim().toLowerCase();
      const actionLower = action ? action.toLowerCase() : null;

      // Build WHERE conditions array
      const conditions = [];

      if (projectId) {
        conditions.push(
          Prisma.sql`al."project_id" = ${parseInt(projectId, 10)}`
        );
      }

      // Case-insensitive actor search (both actor field and details.name JSON field)
      conditions.push(
        Prisma.sql`(
          LOWER(al."actor") LIKE ${`%${actorLower}%`} OR
          LOWER(CAST(al."details"->>'name' AS TEXT)) LIKE ${`%${actorLower}%`}
        )`
      );

      if (actingRole) {
        conditions.push(Prisma.sql`al."acting_role" = ${actingRole}`);
      }

      if (action) {
        conditions.push(
          Prisma.sql`LOWER(al."action") LIKE ${`%${actionLower}%`}`
        );
      }

      if (startDate) {
        conditions.push(Prisma.sql`al."at" >= ${new Date(startDate)}`);
      }

      if (endDate) {
        conditions.push(Prisma.sql`al."at" <= ${new Date(endDate)}`);
      }

      // Count query
      const countQuery = Prisma.sql`
        SELECT COUNT(*)::int as count
        FROM "audit_log" al
        WHERE ${Prisma.join(conditions, Prisma.sql` AND `)}
      `;

      const countResult = await prisma.$queryRaw(countQuery);
      total = countResult[0].count;

      // FindMany query with project join
      const findQuery = Prisma.sql`
        SELECT 
          al.id,
          al.project_id as "projectId",
          al.actor,
          al.acting_role as "actingRole",
          al.action,
          al.details,
          al.at,
          p.id as "project_id",
          p.name as "project_name",
          p.phase as "project_phase"
        FROM "audit_log" al
        LEFT JOIN "projects" p ON al.project_id = p.id
        WHERE ${Prisma.join(conditions, Prisma.sql` AND `)}
        ORDER BY al."at" DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;

      const rawLogs = await prisma.$queryRaw(findQuery);

      // Transform results to match Prisma format
      logs = rawLogs.map((log) => ({
        id: log.id,
        projectId: log.projectId,
        actor: log.actor,
        actingRole: log.actingRole,
        action: log.action,
        details: log.details,
        at: log.at,
        project: log.project_id
          ? {
              id: log.project_id,
              name: log.project_name,
              phase: log.project_phase,
            }
          : null,
      }));
    } else {
      // No actor filter - use regular Prisma queries (more efficient)
      const where = {
        ...(projectId && { projectId: parseInt(projectId, 10) }),
        ...(actingRole && { actingRole: { equals: actingRole } }),
        ...(action && { action: { contains: action, mode: "insensitive" } }),
        ...((startDate || endDate) && {
          at: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }),
      };

      total = await prisma.auditLog.count({ where });

      logs = await prisma.auditLog.findMany({
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
    }

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
