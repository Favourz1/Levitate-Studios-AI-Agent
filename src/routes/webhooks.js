const { Router } = require("express");
const {
  asyncHandler,
  sendSuccessResponse,
} = require("@/middleware/errorHandler");

const router = Router();

// Placeholder webhook routes
router.post(
  "/brevo/inbound",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Webhook received" });
  })
);

router.post(
  "/asana",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Webhook received" });
  })
);

router.post(
  "/apps-script/forms",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Form submission received" });
  })
);

module.exports = { webhooksRouter: router };
