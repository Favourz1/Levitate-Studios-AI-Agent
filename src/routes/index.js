const { Router } = require("express");
const { webhooksRouter } = require("@/routes/webhooks");
const { actionsRouter } = require("@/routes/actions");
const { adminRouter } = require("@/routes/admin");
const { healthRouter } = require("@/routes/health");
const { testsRouter } = require("@/routes/tests");
const { formsRouter } = require("@/routes/forms");
const { workplanRouter } = require("@/routes/workplan");

const router = Router();

// Mount all route modules
router.use("/webhooks", webhooksRouter);
router.use("/actions", actionsRouter);
router.use("/admin", adminRouter);
router.use("/", healthRouter);
router.use("/tests", testsRouter);
router.use("/forms", formsRouter);
router.use("/workplan", workplanRouter);

module.exports = { apiRouter: router };
