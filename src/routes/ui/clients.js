const express = require("express");
const router = express.Router();
const { asyncHandler } = require("@/middleware/errorHandler");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { StatusCodes } = require("http-status-codes");
const { getPrismaClient } = require("@/database");
const { requireAuthForUI } = require("@/middleware/auth");
const { requirePermission } = require("@/utils/permissions");
const { divideAndRoundUp } = require("@/utils/pagination");
const { AuditActions } = require("@/constants");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/clients
 * List clients with filters and pagination
 */
router.get(
  "/",
  requireAuthForUI,
  requirePermission("clients", "view"),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, search, status } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const where = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { primaryEmail: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const total = await prisma.client.count({ where });

    const clients = await prisma.client.findMany({
      where,
      include: {
        _count: {
          select: { projects: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limitNum,
    });

    const totalPages = divideAndRoundUp(total, limitNum);

    return sendSuccessResponse(
      res,
      {
        clients,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      },
      "Clients fetched successfully",
      StatusCodes.OK
    );
  })
);

/**
 * GET /api/v1/ui/clients/:id
 * Get client by ID with projects
 */
router.get(
  "/:id",
  requireAuthForUI,
  requirePermission("clients", "view"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const client = await prisma.client.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        projects: {
          include: {
            documents: {
              take: 1,
              orderBy: { updatedAt: "desc" },
            },
          },
          orderBy: { updatedAt: "desc" },
        },
        // emailThreads: {
        //   include: {
        //     emails: {
        //       orderBy: { receivedAt: "desc" },
        //       take: 10,
        //     },
        //   },
        // },
      },
    });

    if (!client) {
      return sendErrorResponse(res, "Client not found", StatusCodes.NOT_FOUND);
    }

    return sendSuccessResponse(
      res,
      client,
      "Client fetched successfully",
      StatusCodes.OK
    );
  })
);

/**
 * PATCH /api/v1/ui/clients/:id/context
 * Update client context
 */
router.patch(
  "/:id/context",
  requireAuthForUI,
  requirePermission("clients", "editContext"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { context } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!context || typeof context !== "string") {
      return sendErrorResponse(
        res,
        "Context is required",
        StatusCodes.BAD_REQUEST
      );
    }

    const client = await prisma.client.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!client) {
      return sendErrorResponse(res, "Client not found", StatusCodes.NOT_FOUND);
    }

    const updatedClient = await prisma.client.update({
      where: { id: client.id },
      data: { context },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        actor: userId.toString(),
        actingRole,
        action: AuditActions.UPDATE_CLIENT_CONTEXT,
        details: {
          clientId: client.id,
          contextLength: context.length,
          source: "UI",
          name: req.user.name,
        },
        at: new Date(),
      },
    });

    return sendSuccessResponse(
      res,
      updatedClient,
      "Client context updated successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
