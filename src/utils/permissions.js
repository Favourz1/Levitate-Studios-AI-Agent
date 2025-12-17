const { TeamRole } = require("@/constants");
const ALL_PERMISSIONS = {
  documents: ["view", "acceptAndSend", "reject", "regenerate"],
  emails: ["view", "log", "delete"],
  projects: ["view", "viewAll", "advance", "viewContext", "editContext"],
  workplans: ["view", "regenerate"],
  questionnaires: ["view", "process", "flag"],
  quotes: ["view"],
  audit: ["view"],
  team: ["view", "manage", "permissions"],
  settings: ["editRateCard"],
  ops: ["view", "retryJobs", "cleanJobs"],
  clients: ["view", "edit", "viewContext", "editContext"],
};

// Default role permissions (matches frontend DEFAULT_ROLE_PERMISSIONS)
const DEFAULT_ROLE_PERMISSIONS = {
  ADMIN: { ...ALL_PERMISSIONS },
  PROJECT_MANAGER: {
    documents: ["view", "acceptAndSend", "reject", "regenerate"],
    emails: ["view", "log"],
    projects: ["view", "viewAll", "advance", "editContext"],
    workplans: ["view"],
    questionnaires: ["view", "flag"],
    quotes: ["view"],
    audit: ["view"],
    team: ["view"],
    ops: ["view"],
  },
  FINANCE_MANAGER: {
    documents: ["view", "acceptAndSend"],
    emails: ["view", "log"],
    projects: ["view", "viewAll"],
    quotes: ["view"],
    audit: ["view"],
    team: ["view"],
    clients: ["view"],
  },
  CREATIVE_DIRECTOR: {
    documents: ["view", "acceptAndSend", "reject", "regenerate"],
    emails: ["view"],
    projects: ["view", "viewAll", "advance", "editContext"],
    workplans: ["view", "regenerate"],
    questionnaires: ["view", "flag"],
    clients: ["view"],
  },
  ART_DIRECTOR: {
    documents: ["view"],
    projects: ["view"],
    workplans: ["view", "regenerate"],
  },
  MANAGER: {
    documents: ["view"],
    emails: ["view"],
    projects: ["view", "viewAll"],
    questionnaires: ["view", "flag"],
    workplans: ["view"],
  },
  DIGITAL_MARKETER: {
    documents: ["view"],
    projects: ["view"],
  },
  MOTION_GRAPHICS_DESIGNER: {
    documents: ["view"],
    projects: ["view"],
    workplans: ["view"],
  },
  WEB_DESIGNER: {
    documents: ["view"],
    projects: ["view"],
    workplans: ["view"],
  },
  GRAPHICS_DESIGNER: {
    documents: ["view"],
    projects: ["view"],
    workplans: ["view"],
  },
  UI_DESIGNER: {
    documents: ["view"],
    projects: ["view"],
    workplans: ["view"],
  },
  COPY_WRITER: {
    documents: ["view"],
    projects: ["view"],
    workplans: ["view"],
  },
  HR_MANAGER: {
    team: ["view", "manage"],
  },
  CLIENT_SERVICE: {
    documents: ["view"],
    emails: ["view", "log"],
    projects: ["view"],
    questionnaires: ["view"],
    clients: ["view", "editContext"],
  },
};

/**
 * Get permissions for a role (with overrides support)
 * @param {TeamRole} role - The role to get permissions for
 * @param {Object} roleOverrides - Optional permission overrides from database
 * @returns {Object} Permission object
 */
function getRolePermissions(role, roleOverrides = {}) {
  if (role === TeamRole.ADMIN) {
    return DEFAULT_ROLE_PERMISSIONS.ADMIN;
  }

  const basePermissions = DEFAULT_ROLE_PERMISSIONS[role] || {};
  const overrides = roleOverrides[role] || {};

  // Merge base permissions with overrides
  const merged = { ...basePermissions };
  Object.keys(overrides).forEach((category) => {
    merged[category] = overrides[category];
  });

  return merged;
}

/**
 * Check if user has a specific permission
 * @param {TeamRole} role - User's acting role
 * @param {string} category - Permission category (e.g., 'documents', 'projects')
 * @param {string} action - Permission action (e.g., 'view', 'edit')
 * @param {Object} roleOverrides - Optional permission overrides
 * @returns {boolean} True if user has permission
 */
function hasPermission(role, category, action, roleOverrides = {}) {
  if (role === TeamRole.ADMIN) return true;

  const permissions = getRolePermissions(role, roleOverrides);
  const categoryPerms = permissions[category] || [];

  // Special logic: editContext implies viewContext for projects and clients
  if (category === "projects" && action === "viewContext") {
    return (
      categoryPerms.includes("viewContext") ||
      categoryPerms.includes("editContext")
    );
  }

  if (category === "clients" && action === "view") {
    return categoryPerms.includes("view") || categoryPerms.includes("edit");
  }

  if (category === "clients" && action === "viewContext") {
    return (
      categoryPerms.includes("viewContext") ||
      categoryPerms.includes("editContext")
    );
  }

  return categoryPerms.includes(action);
}

// Cache for role overrides to avoid DB hit on every request
let roleOverridesCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Load role overrides from database with caching
 * @returns {Promise<Object>} Role overrides object keyed by role
 */
async function loadRoleOverrides() {
  const now = Date.now();
  if (roleOverridesCache && now - cacheTimestamp < CACHE_TTL) {
    return roleOverridesCache;
  }

  try {
    const { getPrismaClient } = require("@/database");
    const prisma = getPrismaClient();

    const overrides = await prisma.rolePermissionOverride.findMany();

    // Convert array to object keyed by role
    const overridesMap = overrides.reduce((acc, row) => {
      acc[row.role] = row.overrides;
      return acc;
    }, {});

    roleOverridesCache = overridesMap;
    cacheTimestamp = now;

    await prisma.$disconnect();
    return roleOverridesCache;
  } catch (error) {
    console.error("Error loading role overrides:", error);
    return {};
  }
}

/**
 * Invalidate role overrides cache (call after updates)
 */
function invalidateRoleOverridesCache() {
  roleOverridesCache = null;
  cacheTimestamp = 0;
}

/**
 * Middleware factory to check permissions
 * @param {string} category - Permission category
 * @param {string} action - Permission action
 * @returns {Function} Express middleware
 */
function requirePermission(category, action) {
  return async (req, res, next) => {
    try {
      const user = req.user; // Set by auth middleware
      const actingRole = req.headers["x-acting-role"] || user?.roles?.[0]?.role;

      if (!actingRole) {
        return res.status(401).json({
          success: false,
          statusCode: 401,
          message: "Acting role not specified",
          data: null,
        });
      }

      // Load role overrides from database - role overrides stored on RolePermissionOverride table
      // Use caching to avoid DB hit on every request
      const roleOverrides = await loadRoleOverrides();

      if (!hasPermission(actingRole, category, action, roleOverrides)) {
        return res.status(403).json({
          success: false,
          statusCode: 403,
          message: `Permission denied: ${category}.${action}`,
          data: null,
        });
      }

      req.actingRole = actingRole;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  getRolePermissions,
  hasPermission,
  requirePermission,
  invalidateRoleOverridesCache,
  DEFAULT_ROLE_PERMISSIONS,
};
