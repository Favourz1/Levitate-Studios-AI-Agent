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

const prisma = getPrismaClient();

/**
 * GET /api/v1/ui/settings/rate-card
 * Get rate card configuration
 */
router.get(
  "/rate-card",
  requireAuthForUI,
  requirePermission("settings", "editRateCard"),
  asyncHandler(async (req, res) => {
    const config = await prisma.globalConfig.findUnique({
      where: { key: "rate_card" },
    });

    if (!config) {
      return sendSuccessResponse(
        res,
        null,
        "Rate card configuration retrieved successfully",
        StatusCodes.OK
      );
    }

    return sendSuccessResponse(
      res,
      config.value,
      "Rate card configuration retrieved successfully",
      StatusCodes.OK
    );
  })
);

/**
 * PUT /api/v1/ui/settings/rate-card
 * Update rate card configuration
 */
router.put(
  "/rate-card",
  requireAuthForUI,
  requirePermission("settings", "editRateCard"),
  asyncHandler(async (req, res) => {
    const { rateCard } = req.body;
    const userId = req.user.id;
    const actingRole = req.actingRole;

    if (!rateCard) {
      return sendErrorResponse(
        res,
        "Rate card data is required",
        StatusCodes.BAD_REQUEST
      );
    }

    // Enhanced validation of rate card structure based on @src/lib/types.ts
    function validateRateCardObject(rc) {
      if (
        !rc ||
        typeof rc !== "object" ||
        !rc.metadata ||
        typeof rc.metadata !== "object" ||
        !rc.metadata.agency_name ||
        typeof rc.metadata.agency_name !== "string" ||
        !rc.metadata.country_region ||
        typeof rc.metadata.country_region !== "string" ||
        !rc.metadata.document_title ||
        typeof rc.metadata.document_title !== "string" ||
        !rc.sections ||
        !Array.isArray(rc.sections) ||
        rc.sections.length === 0 ||
        !rc.terms_and_conditions ||
        !Array.isArray(rc.terms_and_conditions)
      ) {
        return false;
      }

      // Each section must be an object with required keys
      for (const section of rc.sections) {
        if (
          !section ||
          typeof section !== "object" ||
          !section.category ||
          typeof section.category !== "string" ||
          !section.items ||
          !Array.isArray(section.items)
        ) {
          return false;
        }
        for (const item of section.items) {
          if (
            !item ||
            typeof item !== "object" ||
            typeof item.item !== "string" ||
            !["string", "number"].includes(typeof item.price) ||
            item.item.trim() === ""
          ) {
            return false;
          }
          // Price can be string (e.g., "TBD") or number - both are valid
        }
      }

      // terms_and_conditions should be an array of strings
      if (!rc.terms_and_conditions.every((tc) => typeof tc === "string")) {
        return false;
      }

      return true;
    }

    if (!validateRateCardObject(rateCard)) {
      return sendErrorResponse(
        res,
        "Invalid rate card structure. Required fields: metadata (agency_name, country_region, document_title), sections (array with category and items), terms_and_conditions (array of strings)",
        StatusCodes.BAD_REQUEST
      );
    }

    // Upsert rate card config
    const config = await prisma.globalConfig.upsert({
      where: { key: "rate_card" },
      update: {
        value: rateCard,
        description: "Agency rate card for quote generation",
      },
      create: {
        key: "rate_card",
        value: rateCard,
        description: "Agency rate card for quote generation",
      },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        actor: userId.toString(),
        actingRole,
        action: "UPDATE_RATE_CARD",
        details: { name: req.user.name },
      },
    });

    return sendSuccessResponse(
      res,
      config.value,
      "Rate card updated successfully",
      StatusCodes.OK
    );
  })
);

module.exports = router;
