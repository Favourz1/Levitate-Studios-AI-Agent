const { Router } = require("express");
const { checkDatabaseHealth } = require("@/database");
const { checkQueuesHealth } = require("@/queues");
const { googleIntegration } = require("@/integrations/google");
const {
  asyncHandler,
  sendSuccessResponse,
} = require("@/middleware/errorHandler");

const router = Router();

// Google API connectivity test
router.get(
  "/google-apis",
  asyncHandler(async (req, res) => {
    try {
      const results = await googleIntegration.testAPIConnectivity();

      const allSuccessful = results.driveAPI.success && results.docsAPI.success;
      console.log("results");
      console.log(results);

      if (allSuccessful) {
        sendSuccessResponse(res, {
          status: "success",
          message: "All Google APIs are working correctly",
          results,
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(503).json({
          success: false,
          message: "Google API connectivity issues detected",
          results,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to test Google API connectivity",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  })
);

module.exports = { testsRouter: router };
