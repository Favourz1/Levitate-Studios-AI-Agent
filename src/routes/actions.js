const { Router } = require("express");
const {
  asyncHandler,
  sendSuccessResponse,
} = require("@/middleware/errorHandler");

const router = Router();

// Placeholder action routes
router.get(
  "/review",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Review action" });
  })
);

router.post(
  "/send-to-client",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Send to client action" });
  })
);

router.post(
  "/confirm-accepted",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Confirm accepted action" });
  })
);

module.exports = { actionsRouter: router };
