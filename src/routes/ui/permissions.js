const express = require("express");
const router = express.Router();
const { asyncHandler } = require("@/middleware/errorHandler");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("../../middleware/errorHandler");
const { StatusCodes } = require("http-status-codes");
const { getPrismaClient, withTransaction } = require("@/database");
const { requireAuthForUI } = require("../../middleware/auth");
const {
  requirePermission,
  invalidateRoleOverridesCache,
} = require("../../utils/permissions");
const { TeamRole, AuditActions } = require("@/constants");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/permissions/role-overrides
 * Get all role permission overrides
 */
router.get(
  "/role-overrides",
  requireAuthForUI,
  asyncHandler(async (req, res) => {
    const overrides = await prisma.rolePermissionOverride.findMany({
      orderBy: { role: "asc" },
    });

    // Convert array to object keyed by role for frontend compatibility
    const overridesMap = overrides.reduce((acc, row) => {
      acc[row.role] = row.overrides;
      return acc;
    }, {});

    return sendSuccessResponse(
      res,
      overridesMap,
      "Role permission overrides retrieved successfully",
      StatusCodes.OK
    );
  })
);

/**
 * PUT /api/v1/ui/permissions/role-overrides
 * Update role permission overrides
 * Accepts object keyed by role, each role contains RolePermissions structure
 */
router.put(
  "/role-overrides",
  requireAuthForUI,
  requirePermission("team", "permissions"),
  asyncHandler(async (req, res) => {
    const { roleOverrides } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!roleOverrides || typeof roleOverrides !== "object") {
      return sendErrorResponse(
        res,
        "Role overrides data is required",
        StatusCodes.BAD_REQUEST
      );
    }

    // Validate roles are valid TeamRole enum values
    const validRoles = Object.values(TeamRole);
    const rolesToUpdate = Object.keys(roleOverrides);

    for (const role of rolesToUpdate) {
      if (!validRoles.includes(role)) {
        return sendErrorResponse(
          res,
          `Invalid role: ${role}. Must be one of: ${validRoles.join(", ")}`,
          StatusCodes.BAD_REQUEST
        );
      }
    }

    // Use transaction to update all role overrides atomically
    // Increased timeout to handle bulk operations (14+ roles)
    const updatedOverrides = await withTransaction(
      async (tx) => {
        const results = {};

        for (const [role, overrides] of Object.entries(roleOverrides)) {
          // Upsert each role override
          const result = await tx.rolePermissionOverride.upsert({
            where: { role },
            update: {
              overrides: overrides,
            },
            create: {
              role,
              overrides: overrides,
            },
          });
          results[role] = result.overrides;
        }

        return results;
      },
      { timeout: 30000 }
    ); // 30 seconds timeout for bulk operations

    // Invalidate cache so next request loads fresh data
    invalidateRoleOverridesCache();

    // Log audit
    await prisma.auditLog.create({
      data: {
        actor: userId.toString(),
        actingRole,
        action: AuditActions.UPDATE_ROLE_PERMISSION_OVERRIDES,
        details: {
          rolesUpdated: rolesToUpdate,
          name: req.user.name,
        },
      },
    });

    return sendSuccessResponse(
      res,
      updatedOverrides,
      "Role permission overrides updated successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
