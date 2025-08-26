const { Router } = require("express");
const {
  asyncHandler,
  sendSuccessResponse,
} = require("@/middleware/errorHandler");

const router = Router();

// Placeholder admin routes
router.get(
  "/projects",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { projects: [] });
  })
);

router.post(
  "/project/:id/accept-doc",
  asyncHandler(async (req, res) => {
    sendSuccessResponse(res, { message: "Document accepted" });
  })
);

module.exports = { adminRouter: router };
