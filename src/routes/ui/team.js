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
const { requirePermission } = require("../../utils/permissions");
const { TeamRole, AuditActions, CriticalTeamRoles } = require("@/constants");
const bcrypt = require("bcrypt");
const { getAsanaIntegration } = require("@/integrations/asana");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/team
 * List all active team members
 */
router.get(
  "/",
  requireAuthForUI,
  requirePermission("team", "view"),
  asyncHandler(async (req, res) => {
    const members = await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });

    // Remove password from response - roles is already in JSON field
    const sanitized = members.map((m) => {
      const { password, ...rest } = m;
      return rest;
    });

    return sendSuccessResponse(
      res,
      { members: sanitized },
      "Team members retrieved successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/team
 * Create new team member
 */
router.post(
  "/",
  requireAuthForUI,
  requirePermission("team", "manage"),
  asyncHandler(async (req, res) => {
    const { name, email, roles } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (
      !name ||
      !email ||
      !roles ||
      !Array.isArray(roles) ||
      roles.length === 0
    ) {
      return sendErrorResponse(
        res,
        "Name, email, and at least one role are required",
        StatusCodes.BAD_REQUEST
      );
    }

    // Look up user in Asana workspace by email
    let asanaUserGid = null;
    try {
      const asanaIntegration = getAsanaIntegration();
      const workspaceUsers = await asanaIntegration.getWorkspaceUsers();

      // Find user by email (case-insensitive comparison)
      const emailLower = email.toLowerCase().trim();
      const asanaUser = workspaceUsers.find(
        (user) => user.email && user.email.toLowerCase().trim() === emailLower
      );

      if (!asanaUser || !asanaUser.gid) {
        return sendErrorResponse(
          res,
          `User with email ${email} not found in Asana workspace. Please add this user to Asana before adding them as a team member.`,
          StatusCodes.BAD_REQUEST
        );
      }

      asanaUserGid = asanaUser.gid;
    } catch (error) {
      // If Asana API call fails, return error
      return sendErrorResponse(
        res,
        `Failed to verify user in Asana workspace: ${error.message}. Please ensure the user exists in Asana before adding them as a team member.`,
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    // Validate roles against TeamRole constants
    const validRoles = Object.values(TeamRole);

    for (const roleData of roles) {
      if (!validRoles.includes(roleData.role)) {
        return sendErrorResponse(
          res,
          `Invalid role: ${roleData.role}. Must be one of: ${validRoles.join(
            ", "
          )}`,
          StatusCodes.BAD_REQUEST
        );
      }
    }

    // Prepare roles JSON array - roles is stored as JSON field
    const rolesJson = roles.map((r) => ({
      role: r.role,
      isLead: r.isLead || false,
    }));

    // Handle lead role assignment (overwrite previous lead) - update other members' roles JSON
    for (const roleData of roles) {
      if (roleData.isLead) {
        // Find all other active members with this role
        const otherMembers = await prisma.teamMember.findMany({
          where: {
            isActive: true,
            // id: { not: userId }, // Exclude current user (if creating self, but shouldn't happen)
          },
        });

        // Update their roles JSON to remove lead flag for this role
        for (const otherMember of otherMembers) {
          const memberRoles = Array.isArray(otherMember.roles)
            ? otherMember.roles
            : [];
          const updatedRoles = memberRoles.map((r) => {
            const roleObj =
              typeof r === "object" ? r : { role: r, isLead: false };
            if (roleObj.role === roleData.role) {
              return { ...roleObj, isLead: false };
            }
            return roleObj;
          });

          // Only update if roles changed
          if (JSON.stringify(memberRoles) !== JSON.stringify(updatedRoles)) {
            await prisma.teamMember.update({
              where: { id: otherMember.id },
              data: { roles: updatedRoles },
            });
          }
        }
      }
    }

    // Check if email already exists
    const existing = await prisma.teamMember.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      // If member exists and is active, return error
      if (existing.isActive) {
        return sendErrorResponse(
          res,
          "Email already exists",
          StatusCodes.BAD_REQUEST
        );
      }

      // If member exists but is inactive, reactivate them instead of creating new
      // This preserves the member's ID and history
      const reactivated = await prisma.teamMember.update({
        where: { id: existing.id },
        data: {
          name,
          asanaUserGid: asanaUserGid,
          roles: rolesJson,
          isActive: true, // Reactivate
        },
      });

      // Log audit for reactivation
      await prisma.auditLog.create({
        data: {
          actor: userId.toString(),
          actingRole,
          action: AuditActions.REACTIVATE_TEAM_MEMBER,
          details: {
            memberId: reactivated.id,
            email: reactivated.email,
            action: "reactivated",
            roles: roles.map((r) => r.role),
            name: req.user.name,
          },
        },
      });

      const { password, ...sanitized } = reactivated;
      return sendSuccessResponse(
        res,
        sanitized,
        "Team member reactivated successfully",
        StatusCodes.OK
      );
    }

    // Create team member with roles as JSON field
    const member = await prisma.teamMember.create({
      data: {
        name,
        email: email.toLowerCase(),
        asanaUserGid: asanaUserGid,
        roles: rolesJson, // Store as JSON field
      },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        actor: userId.toString(),
        actingRole,
        action: AuditActions.CREATE_TEAM_MEMBER,
        details: {
          memberId: member.id,
          email: member.email,
          roles: roles.map((r) => r.role),
          name: req.user.name,
        },
      },
    });

    const { password, ...sanitized } = member;
    return sendSuccessResponse(
      res,
      sanitized,
      "Team member created successfully",
      StatusCodes.CREATED
    );
  })
);

/**
 * PATCH /api/v1/ui/team/:id
 * Update team member
 */
router.patch(
  "/:id",
  requireAuthForUI,
  requirePermission("team", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const { name, email, asanaUserGid, roles } = body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    const member = await prisma.teamMember.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!member) {
      return sendErrorResponse(
        res,
        "Team member not found",
        StatusCodes.NOT_FOUND
      );
    }

    // Validate roles against TeamRole constants if provided
    if (roles && Array.isArray(roles)) {
      const validRoles = Object.values(TeamRole);

      for (const roleData of roles) {
        if (!validRoles.includes(roleData.role)) {
          return sendErrorResponse(
            res,
            `Invalid role: ${roleData.role}. Must be one of: ${validRoles.join(
              ", "
            )}`,
            StatusCodes.BAD_REQUEST
          );
        }
      }
    }

    // Check email uniqueness if email is being updated
    if (email && email.toLowerCase() !== member.email) {
      const existing = await prisma.teamMember.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existing) {
        return sendErrorResponse(
          res,
          "Email already exists",
          StatusCodes.BAD_REQUEST
        );
      }
    }

    // --------- PATCH CRITICAL ROLES ENFORCEMENT ----------
    // If roles are being updated, ensure we don't orphan a critical role
    if (roles && Array.isArray(roles)) {
      // Roles after update
      const updatedRolesSet = new Set(roles.map((r) => r.role));
      // Roles currently on this member
      const currentRolesSet = new Set(
        Array.isArray(member.roles)
          ? member.roles.map((r) => (typeof r === "object" ? r.role : r))
          : []
      );

      // Find all critical roles that would be lost on this member
      for (const critRole of CriticalTeamRoles) {
        const hadRole = currentRolesSet.has(critRole);
        const willHaveRole = updatedRolesSet.has(critRole);

        if (hadRole && !willHaveRole) {
          // This update would remove a critical role from this user
          // Make sure at least one other active member has this role
          const otherMembers = await prisma.teamMember.findMany({
            where: {
              id: { not: member.id },
              isActive: true,
            },
          });

          const hasOtherWithCritRole = otherMembers.some((m) => {
            const mRolesArr = Array.isArray(m.roles)
              ? m.roles.map((r) => (typeof r === "object" ? r.role : r))
              : [];
            return mRolesArr.includes(critRole);
          });

          if (!hasOtherWithCritRole) {
            return sendErrorResponse(
              res,
              `Cannot remove last ${critRole}. At least one active ${critRole} is required.`,
              StatusCodes.BAD_REQUEST
            );
          }
        }
      }
    }
    // ------------------------------------------------------

    // Update basic fields
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email.toLowerCase();
    // if (asanaUserGid !== undefined && typeof asanaUserGid === "string")
    //   updateData.asanaUserGid = asanaUserGid;

    // Update roles if provided - roles is JSON field
    if (roles && Array.isArray(roles)) {
      // Prepare roles JSON array
      const rolesJson = roles.map((r) => ({
        role: r.role,
        isLead: r.isLead || false,
      }));

      updateData.roles = rolesJson;

      // Handle lead role assignment (overwrite previous lead)
      for (const roleData of roles) {
        if (roleData.isLead) {
          // Find all other active members with this role as lead
          const otherMembers = await prisma.teamMember.findMany({
            where: {
              // id: { not: member.id },
              isActive: true,
            },
          });

          // Update their roles JSON to remove lead flag for this role
          for (const otherMember of otherMembers) {
            const memberRoles = Array.isArray(otherMember.roles)
              ? otherMember.roles
              : [];
            const updatedRoles = memberRoles.map((r) => {
              const roleObj =
                typeof r === "object" ? r : { role: r, isLead: false };
              if (roleObj.role === roleData.role) {
                return { ...roleObj, isLead: false };
              }
              return roleObj;
            });

            // Only update if roles changed
            if (JSON.stringify(memberRoles) !== JSON.stringify(updatedRoles)) {
              await prisma.teamMember.update({
                where: { id: otherMember.id },
                data: { roles: updatedRoles },
              });
            }
          }
        }
      }
    }

    const updated = await prisma.teamMember.update({
      where: { id: member.id },
      data: updateData,
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        actor: userId.toString(),
        actingRole,
        action: AuditActions.UPDATE_TEAM_MEMBER,
        details: { memberId: member.id, name: req.user.name },
      },
    });

    const { password, ...sanitized } = updated;
    return sendSuccessResponse(
      res,
      sanitized,
      "Team member updated successfully",
      StatusCodes.OK
    );
  })
);

/**
 * DELETE /api/v1/ui/team/:id
 * Delete (deactivate) team member
 */
router.delete(
  "/:id",
  requireAuthForUI,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    // Only allow team members with ADMIN role to delete other users
    // req.user is guaranteed to be populated by requireAuthForUI middleware

    // Fetch the acting user's own roles
    const actingMember = await prisma.teamMember.findUnique({
      where: { id: userId },
    });

    if (!actingMember) {
      return sendErrorResponse(
        res,
        "Current team member not found",
        StatusCodes.UNAUTHORIZED
      );
    }

    // roles field is a JSON array like: [{ role: "ADMIN", isLead: true }, ...]
    const hasAdminRole = Array.isArray(actingMember.roles)
      ? actingMember.roles.some(
          (r) => typeof r === "object" && r.role === TeamRole.ADMIN
        )
      : false;

    // Only admins can delete *another* user (users can't delete themselves)
    if (!hasAdminRole || parseInt(id, 10) === userId) {
      return sendErrorResponse(
        res,
        "Only admins can delete other users. Users cannot delete themselves.",
        StatusCodes.FORBIDDEN
      );
    }

    const member = await prisma.teamMember.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!member) {
      return sendErrorResponse(
        res,
        "Team member not found",
        StatusCodes.NOT_FOUND
      );
    }

    // Parse member roles from JSON field
    const memberRoles = Array.isArray(member.roles)
      ? member.roles.map((r) => (typeof r === "object" ? r.role : r))
      : [];

    // Check if deletion would leave critical roles empty
    for (const role of memberRoles) {
      if (CriticalTeamRoles.includes(role)) {
        // Count other active members with this role (check JSON field)
        const otherMembers = await prisma.teamMember.findMany({
          where: {
            id: { not: member.id },
            isActive: true,
          },
        });

        const hasOtherMemberWithRole = otherMembers.some((m) => {
          const mRoles = Array.isArray(m.roles)
            ? m.roles.map((r) => (typeof r === "object" ? r.role : r))
            : [];
          return mRoles.includes(role);
        });

        if (!hasOtherMemberWithRole) {
          return sendErrorResponse(
            res,
            `Cannot delete last ${role}. At least one active ${role} is required.`,
            StatusCodes.BAD_REQUEST
          );
        }
      }
    }

    // Use transaction to transfer work and deactivate member
    await withTransaction(async (tx) => {
      // For each role the member has, find replacement (lead or any member with that role)
      for (const role of memberRoles) {
        // Find lead for this role, or any active member with this role
        const replacementMembers = await tx.teamMember.findMany({
          where: {
            id: { not: member.id },
            isActive: true,
          },
        });

        const replacement = replacementMembers.find((m) => {
          const mRoles = Array.isArray(m.roles) ? m.roles : [];
          const hasRole = mRoles.some((r) => {
            const roleObj =
              typeof r === "object" ? r : { role: r, isLead: false };
            return roleObj.role === role;
          });
          return hasRole;
        });

        if (replacement) {
          // Transfer references: update all places where member.asanaUserGid is referenced
          // This includes: asanaLinks (pmGid, financeGid)
          // Note: pmGid and financeGid are in AsanaLink model, not Project model
          await tx.asanaLink.updateMany({
            where: {
              OR: [
                { pmGid: member.asanaUserGid },
                { financeGid: member.asanaUserGid },
              ],
            },
            data: {
              pmGid:
                role === TeamRole.PROJECT_MANAGER
                  ? replacement.asanaUserGid
                  : undefined,
              financeGid:
                role === TeamRole.FINANCE_MANAGER
                  ? replacement.asanaUserGid
                  : undefined,
            },
          });
        }
      }

      // Set member to inactive
      await tx.teamMember.update({
        where: { id: member.id },
        data: { isActive: false },
      });

      // Log audit
      await tx.auditLog.create({
        data: {
          actor: userId.toString(),
          actingRole,
          action: AuditActions.DELETE_TEAM_MEMBER,
          details: {
            memberId: member.id,
            email: member.email,
            roles: memberRoles,
          },
        },
      });
    });

    return sendSuccessResponse(
      res,
      { message: "Team member deactivated" },
      "Team member deactivated successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/team/:id/password
 * Set or reset team member password
 */
router.post(
  "/:id/password",
  requireAuthForUI,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!password || password.length < 8) {
      return sendErrorResponse(
        res,
        "Password must be at least 8 characters",
        StatusCodes.BAD_REQUEST
      );
    }

    // Only allow team members with ADMIN role to set/reset passwords for other users
    // req.user is guaranteed to be populated by requireAuthForUI middleware

    // Fetch the acting user's own roles
    const actingMember = await prisma.teamMember.findUnique({
      where: { id: userId },
    });

    if (!actingMember) {
      return sendErrorResponse(
        res,
        "Current team member not found",
        StatusCodes.UNAUTHORIZED
      );
    }

    // roles field is a JSON array like: [{ role: "ADMIN", isLead: true }, ...]
    const hasAdminRole = Array.isArray(actingMember.roles)
      ? actingMember.roles.some(
          (r) => typeof r === "object" && r.role === TeamRole.ADMIN
        )
      : false;

    // Only admins can set/reset password for *another* user (users can't reset their own)
    if (!hasAdminRole || parseInt(id, 10) === userId) {
      return sendErrorResponse(
        res,
        "Only admins can set/reset other users' passwords. Users cannot reset their own passwords.",
        StatusCodes.FORBIDDEN
      );
    }

    const member = await prisma.teamMember.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!member) {
      return sendErrorResponse(
        res,
        "Team member not found",
        StatusCodes.NOT_FOUND
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.teamMember.update({
      where: { id: member.id },
      data: { password: hashedPassword },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        actor: userId.toString(),
        actingRole,
        action: AuditActions.SET_TEAM_MEMBER_PASSWORD,
        details: { memberId: member.id, name: req.user.name },
      },
    });

    return sendSuccessResponse(
      res,
      { message: "Password set successfully" },
      "Password set successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
