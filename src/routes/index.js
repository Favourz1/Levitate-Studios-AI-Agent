const { Router } = require("express");
const { webhooksRouter } = require("@/routes/webhooks");
const { actionsRouter } = require("@/routes/actions");
const { adminRouter } = require("@/routes/admin");
const { healthRouter } = require("@/routes/health");

const router = Router();

// Mount all route modules
router.use("/webhooks", webhooksRouter);
router.use("/actions", actionsRouter);
router.use("/admin", adminRouter);
router.use("/", healthRouter);

module.exports = { apiRouter: router };
