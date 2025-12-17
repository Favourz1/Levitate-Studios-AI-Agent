const express = require("express");
const router = express.Router();
const { asyncHandler } = require("@/middleware/errorHandler");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("@/middleware/errorHandler");
const { StatusCodes } = require("http-status-codes");
const { getPrismaClient } = require("@/database");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { appConfig } = require("@/config");
const { TeamRole } = require("@/constants");
const { brevoIntegration } = require("@/integrations");

const prisma = getPrismaClient();

// TODO: Store verification codes temporarily with Redis
const verificationCodes = new Map();

/**
 * POST /api/v1/ui/auth/admin/signup/request-code
 * Request verification code for admin signup
 */
router.post(
  "/admin/signup/request-code",
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return sendErrorResponse(
        res,
        "Email is required",
        StatusCodes.BAD_REQUEST
      );
    }

    // Check if email matches ADMIN_EMAIL env or exists as admin in database
    const adminEmailEnv = appConfig.server.adminEmail;
    const isAdminEmail =
      adminEmailEnv && email.toLowerCase() === adminEmailEnv.toLowerCase();

    let teamMember = null;
    if (!isAdminEmail) {
      // Find team member with ADMIN role - roles is JSON field
      const allMembers = await prisma.teamMember.findMany({
        where: {
          email: email.toLowerCase(),
          isActive: true,
        },
      });

      // Filter members that have ADMIN role in their roles JSON field
      teamMember = allMembers.find((member) => {
        if (!member.roles) return false;
        const roles = Array.isArray(member.roles)
          ? member.roles.map((r) => (typeof r === "object" ? r.role : r))
          : [];
        return roles.includes(TeamRole.ADMIN);
      });
    }

    if (!isAdminEmail && !teamMember) {
      return sendErrorResponse(
        res,
        "Email is not authorized for admin signup",
        StatusCodes.FORBIDDEN
      );
    }

    // Generate 6-digit verification code
    const code = crypto.randomInt(100000, 999999).toString();
    verificationCodes.set(email.toLowerCase(), {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    // Send verification code via email
    await brevoIntegration.sendTransactionalEmail({
      senderEmail: `noreply@${appConfig.emailDomain}`,
      to: [email],
      subject: "Admin Signup Verification Code",
      htmlContent: `
        <h2>Admin Signup Verification</h2>
        <p>Your verification code is: <strong>${code}</strong></p>
        <p>This code will expire in 10 minutes.</p>
        <hr>
        <p><small>This is a notification from Levitate Studios AI Agent.</small></p>
      `,
    });

    return sendSuccessResponse(
      res,
      { message: "Verification code sent to email" },
      "Verification code sent successfully",
      StatusCodes.OK
    );
  })
);

/**
 * POST /api/v1/ui/auth/admin/signup
 * Complete admin signup with verification code
 */
router.post(
  "/admin/signup",
  asyncHandler(async (req, res) => {
    const { email, password, verificationCode } = req.body;

    if (!email || !password || !verificationCode) {
      return sendErrorResponse(
        res,
        "Email, password, and verification code are required",
        StatusCodes.BAD_REQUEST
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return sendErrorResponse(
        res,
        "Password must be at least 8 characters",
        StatusCodes.BAD_REQUEST
      );
    }

    // Verify code
    const stored = verificationCodes.get(email.toLowerCase());
    if (!stored || stored.code !== verificationCode) {
      return sendErrorResponse(
        res,
        "Invalid verification code",
        StatusCodes.BAD_REQUEST
      );
    }

    if (Date.now() > stored.expiresAt) {
      verificationCodes.delete(email.toLowerCase());
      return sendErrorResponse(
        res,
        "Verification code expired",
        StatusCodes.BAD_REQUEST
      );
    }

    // Hash password - use bcrypt
    const bcrypt = require("bcrypt");
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if team member exists
    let teamMember = await prisma.teamMember.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (teamMember) {
      // Update password
      teamMember = await prisma.teamMember.update({
        where: { id: teamMember.id },
        data: { password: hashedPassword },
      });
    } else {
      verificationCodes.delete(email.toLowerCase());
      return sendErrorResponse(
        res,
        "Email not found in team members, please contact your developer to add you to the team",
        StatusCodes.NOT_FOUND
      );
    }

    // Clean up verification code
    verificationCodes.delete(email.toLowerCase());

    // Parse roles from JSON field
    const userRoles = Array.isArray(teamMember.roles)
      ? teamMember.roles.map((r) => (typeof r === "object" ? r.role : r))
      : [];

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: teamMember.id,
        email: teamMember.email,
        roles: userRoles,
      },
      appConfig.server.jwtSecret,
      { expiresIn: "7d" }
    );

    return sendSuccessResponse(
      res,
      {
        token,
        user: {
          id: teamMember.id,
          email: teamMember.email,
          name: teamMember.name,
          roles: teamMember.roles, // Return JSON field as-is
          isActive: teamMember.isActive,
        },
      },
      "Account created successfully",
      StatusCodes.CREATED
    );
  })
);

/**
 * POST /api/v1/ui/auth/login
 * Team member login
 */
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendErrorResponse(
        res,
        "Email and password are required",
        StatusCodes.BAD_REQUEST
      );
    }

    // Find team member - roles is JSON field, not relation
    const teamMember = await prisma.teamMember.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!teamMember || !teamMember.isActive) {
      return sendErrorResponse(
        res,
        "Invalid credentials or not active",
        StatusCodes.UNAUTHORIZED
      );
    }

    // Check if password is set
    if (!teamMember.password) {
      return sendErrorResponse(
        res,
        "Password not set. Please contact admin to set your password.",
        StatusCodes.UNAUTHORIZED
      );
    }

    // Verify password
    const bcrypt = require("bcrypt");
    const isValid = await bcrypt.compare(password, teamMember.password);

    if (!isValid) {
      return sendErrorResponse(
        res,
        "Invalid credentials or password not set",
        StatusCodes.UNAUTHORIZED
      );
    }

    // Parse roles from JSON field
    const userRoles = Array.isArray(teamMember.roles)
      ? teamMember.roles.map((r) => (typeof r === "object" ? r.role : r))
      : [];

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: teamMember.id,
        email: teamMember.email,
        roles: userRoles,
      },
      appConfig.server.jwtSecret,
      { expiresIn: "7d" }
    );

    return sendSuccessResponse(
      res,
      {
        token,
        user: {
          id: teamMember.id,
          email: teamMember.email,
          name: teamMember.name,
          roles: teamMember.roles, // Return JSON field as-is
          isActive: teamMember.isActive,
        },
      },
      "Login successful",
      StatusCodes.OK
    );
  })
);

module.exports = router;
