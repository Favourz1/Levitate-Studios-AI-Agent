const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError, BaseError } = require("@/utils/errors");
const { createActionToken, generateDedupeKey } = require("@/utils");
const { TeamRole } = require("@/constants");

const logger = createLogger("service:action");
const prisma = getPrismaClient();

/**
 * ActionService handles secure action links and nonce tracking for email buttons
 * Provides JWT token generation, validation, and idempotency checking
 */
class ActionService {
  /**
   * Create a secure action token for email buttons
   * @param {Object} payload - Token payload
   * @param {string} payload.action - Action type (SEND_TO_CLIENT, etc.)
   * @param {number} payload.documentId - Document ID
   * @param {number} payload.projectId - Project ID
   * @param {number} payload.userId - User ID who can use this token
   * @param {string} payload.userEmail - User email for feedback
   * @param {string} payload.userName - User name for audit
   * @param {string} expiresIn - Token expiration (default: 24h)
   * @returns {Promise<Object>} Token and nonce information
   */
  static async createActionToken(payload, expiresIn = "24h") {
    try {
      // Validate required payload fields
      const requiredFields = [
        "action",
        "documentId",
        "projectId",
        "userId",
        "userEmail",
        "userName",
      ];
      for (const field of requiredFields) {
        if (!payload[field]) {
          throw new ValidationError(`Missing required payload field: ${field}`);
        }
      }

      // Generate unique nonce for this action
      const nonce = generateDedupeKey(
        "action",
        payload.action.toLowerCase(),
        payload.documentId,
        payload.projectId,
        payload.userId
      );

      // Create token payload with nonce
      const tokenPayload = {
        ...payload,
        nonce,
        iat: Math.floor(Date.now() / 1000), // Issued at time
      };

      // Generate JWT token
      const token = createActionToken(tokenPayload, expiresIn);

      logger.info(
        {
          action: payload.action,
          documentId: payload.documentId,
          projectId: payload.projectId,
          userId: payload.userId,
          nonce,
        },
        "Action token created successfully"
      );

      return {
        token,
        nonce,
        expiresIn,
        payload: tokenPayload,
      };
    } catch (error) {
      logger.error(
        {
          error: error.message,
          payload: payload,
        },
        "Failed to create action token"
      );
      throw error;
    }
  }

  /**
   * Check if an action nonce has already been used
   * @param {string} nonce - Action nonce to check
   * @returns {Promise<Object|null>} Existing action record or null
   */
  static async checkActionNonce(nonce) {
    try {
      if (!nonce || typeof nonce !== "string") {
        throw new ValidationError("Nonce is required and must be a string");
      }

      // Check if nonce exists in job_runs table (reusing existing deduplication system)
      const existingJob = await prisma.jobRun.findUnique({
        where: { dedupeKey: nonce },
        select: {
          id: true,
          name: true,
          status: true,
          args: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
        },
      });

      if (existingJob) {
        logger.info(
          {
            nonce,
            jobId: existingJob.id,
            status: existingJob.status,
            processedAt: existingJob.finishedAt || existingJob.startedAt,
          },
          "Action nonce already used"
        );

        return {
          used: true,
          processedAt: existingJob.finishedAt || existingJob.startedAt,
          status: existingJob.status,
          jobId: existingJob.id,
          args: existingJob.args,
        };
      }

      return null;
    } catch (error) {
      logger.error(
        {
          nonce,
          error: error.message,
        },
        "Failed to check action nonce"
      );
      throw error;
    }
  }

  /**
   * Mark an action nonce as used
   * @param {string} nonce - Action nonce to mark as used
   * @param {string} correlationId - Correlation ID for tracking
   * @param {Object} actionData - Action data to store
   * @returns {Promise<Object>} Job run record
   */
  static async markActionNonceUsed(nonce, correlationId, actionData = {}) {
    try {
      if (!nonce || typeof nonce !== "string") {
        throw new ValidationError("Nonce is required and must be a string");
      }

      if (!correlationId || typeof correlationId !== "string") {
        throw new ValidationError(
          "Correlation ID is required and must be a string"
        );
      }

      // Create job run record to mark nonce as used
      const jobRun = await prisma.jobRun.create({
        data: {
          name: "ACTION_EXECUTED",
          args: {
            nonce,
            correlationId,
            actionData,
            executedAt: new Date().toISOString(),
          },
          status: "SUCCEEDED",
          dedupeKey: nonce,
          attempts: 1,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      logger.info(
        {
          nonce,
          correlationId,
          jobRunId: jobRun.id,
        },
        "Action nonce marked as used"
      );

      return jobRun;
    } catch (error) {
      // Handle unique constraint violation (nonce already used)
      if (error.code === "P2002" && error.meta?.target?.includes("dedupeKey")) {
        logger.warn(
          {
            nonce,
            correlationId,
          },
          "Action nonce already marked as used (race condition)"
        );

        // Return existing record
        const existingJob = await prisma.jobRun.findUnique({
          where: { dedupeKey: nonce },
        });

        return existingJob;
      }

      logger.error(
        {
          nonce,
          correlationId,
          error: error.message,
        },
        "Failed to mark action nonce as used"
      );
      throw error;
    }
  }

  /**
   * Validate team member permissions for action
   * @param {number} userId - User ID to validate
   * @param {Array<string>} allowedRoles - Allowed roles for this action
   * @returns {Promise<Object>} Team member information
   */
  static async validateTeamMemberPermissions(
    userId,
    allowedRoles = [TeamRole.PROJECT_MANAGER, TeamRole.ADMIN, TeamRole.MANAGER]
  ) {
    try {
      if (!userId || typeof userId !== "number") {
        throw new ValidationError("User ID is required and must be a number");
      }

      if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
        throw new ValidationError("Allowed roles must be a non-empty array");
      }

      // Find team member by ID
      const teamMember = await prisma.teamMember.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          roles: true,
          isActive: true,
        },
      });

      if (!teamMember) {
        throw new ValidationError(`Team member not found with ID: ${userId}`);
      }

      if (!teamMember.isActive) {
        throw new ValidationError(
          `Team member is not active: ${teamMember.name}`
        );
      }

      // Check if user has any of the allowed roles
      const userRoles = Array.isArray(teamMember.roles) ? teamMember.roles : [];
      const hasPermission = userRoles.some((roleObj) => {
        const roleName = typeof roleObj === "string" ? roleObj : roleObj.role;
        return allowedRoles.includes(roleName);
      });

      if (!hasPermission) {
        throw new ValidationError(
          `User ${
            teamMember.name
          } does not have required permissions. Required roles: ${allowedRoles.join(
            ", "
          )}`
        );
      }

      logger.info(
        {
          userId,
          userName: teamMember.name,
          userRoles: userRoles.map((r) => (typeof r === "string" ? r : r.role)),
          allowedRoles,
        },
        "Team member permissions validated successfully"
      );

      return {
        id: teamMember.id,
        name: teamMember.name,
        email: teamMember.email,
        roles: userRoles,
        hasPermission: true,
      };
    } catch (error) {
      logger.error(
        {
          userId,
          allowedRoles,
          error: error.message,
        },
        "Failed to validate team member permissions"
      );
      throw error;
    }
  }

  /**
   * Create audit log entry for action execution
   * @param {Object} params - Audit log parameters
   * @param {number} params.projectId - Project ID
   * @param {string} params.actor - Actor description
   * @param {string} params.action - Action performed
   * @param {Object} params.details - Action details
   * @returns {Promise<Object>} Audit log entry
   */
  static async createAuditLog({ projectId, actor, action, details }) {
    try {
      const auditEntry = await prisma.auditLog.create({
        data: {
          projectId,
          actor,
          action,
          details,
          at: new Date(),
        },
      });

      logger.info(
        {
          auditLogId: auditEntry.id,
          projectId,
          actor,
          action,
        },
        "Audit log entry created"
      );

      return auditEntry;
    } catch (error) {
      logger.error(
        {
          projectId,
          actor,
          action,
          error: error.message,
        },
        "Failed to create audit log entry"
      );
      throw error;
    }
  }
}

module.exports = { ActionService };
