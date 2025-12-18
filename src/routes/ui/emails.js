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
const { requirePermission, hasPermission } = require("@/utils/permissions");
const { AuditActions } = require("@/constants");

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/emails/threads
 * List email threads for a project
 */
router.get(
  "/threads",
  requireAuthForUI,
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const actingRole = req.actingRole;

    // Check permission: need view or log permission
    const canView = hasPermission(actingRole, "emails", "view", {});
    const canLog = hasPermission(actingRole, "emails", "log", {});

    if (!canView && !canLog) {
      return sendErrorResponse(
        res,
        "Permission denied: emails.view or emails.log required",
        StatusCodes.FORBIDDEN
      );
    }

    // If only log permission, return empty (frontend will show only log form)
    if (!canView && canLog) {
      return sendSuccessResponse(
        res,
        { threads: [] },
        "Email threads fetched successfully",
        StatusCodes.OK
      );
    }

    const where = projectId ? { projectId: parseInt(projectId, 10) } : {};

    const threads = await prisma.emailThread.findMany({
      where,
      include: {
        emails: {
          orderBy: { receivedAt: "asc" },
        },
        project: {
          include: { client: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return sendSuccessResponse(
      res,
      { threads },
      "Email threads fetched successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/emails/log
 * Manually log an email
 */
router.post(
  "/log",
  requireAuthForUI,
  requirePermission("emails", "log"),
  asyncHandler(async (req, res) => {
    const {
      projectId,
      direction,
      fromAddr,
      toAddr,
      subject,
      textBody,
      htmlBody,
      receivedAt,
    } = req.body;

    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!projectId || !direction || !fromAddr || !toAddr || !subject) {
      return sendErrorResponse(
        res,
        "projectId, direction, fromAddr, toAddr, and subject are required",
        StatusCodes.BAD_REQUEST
      );
    }

    // Find project to get clientId
    const project = await prisma.project.findUnique({
      where: { id: parseInt(projectId, 10) },
    });

    if (!project) {
      return sendErrorResponse(res, "Project not found", StatusCodes.NOT_FOUND);
    }

    // Find existing email thread for this project (every project should have a thread)
    let thread = await prisma.emailThread.findFirst({
      where: { projectId: project.id },
    });

    // Only create thread if it doesn't exist (highly unlikely but handle edge case)
    if (!thread) {
      thread = await prisma.emailThread.create({
        data: {
          projectId: project.id,
          clientId: project.clientId,
          replyToAddress: direction === "INBOUND" ? toAddr : fromAddr,
        },
      });
    }

    // Create email record
    const email = await prisma.email.create({
      data: {
        threadId: thread.id,
        direction,
        fromAddr,
        toAddr,
        subject,
        textBody,
        htmlBody,
        rawHeaders: {},
        receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
        processed: false,
        isManuallyLogged: true, // Mark as manually logged
      },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        projectId: parseInt(projectId, 10),
        actor: userId.toString(),
        actingRole,
        action: AuditActions.LOG_EMAIL,
        details: {
          emailId: email.id,
          direction,
          subject,
          name: req.user.name,
        },
      },
    });

    return sendSuccessResponse(
      res,
      email,
      "Email logged successfully",
      StatusCodes.CREATED
    );
  })
);

/**
 * DELETE /api/v1/ui/emails/:id
 * Delete manually logged email
 */
router.delete(
  "/:id",
  requireAuthForUI,
  requirePermission("emails", "delete"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    const email = await prisma.email.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        thread: {
          select: {
            projectId: true,
          },
        },
      },
    });

    if (!email) {
      return sendErrorResponse(res, "Email not found", StatusCodes.NOT_FOUND);
    }

    // Cannot delete system-logged emails
    if (!email.isManuallyLogged) {
      return sendErrorResponse(
        res,
        "Cannot delete system-logged emails",
        StatusCodes.FORBIDDEN
      );
    }

    await prisma.email.delete({
      where: { id: email.id },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        projectId: email.thread?.projectId || null,
        actor: userId.toString(),
        actingRole,
        action: AuditActions.DELETE_EMAIL,
        details: { emailId: email.id, name: req.user.name },
      },
    });

    return sendSuccessResponse(
      res,
      { message: "Email deleted successfully" },
      "Email deleted successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
