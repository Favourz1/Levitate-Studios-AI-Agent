const express = require("express");
const router = express.Router();
const auth = require("./auth");
const projects = require("./projects");
const clients = require("./clients");
const documents = require("./documents");
const workplans = require("./workplans");
const quotes = require("./quotes");
const emails = require("./emails");
const team = require("./team");
const permissions = require("./permissions");
const audit = require("./audit");
const dashboard = require("./dashboard");
const ops = require("./ops");
const settings = require("./settings");
const questionnaires = require("./questionnaires");

// Mount all UI routes
router.use("/auth", auth);
router.use("/projects", projects);
router.use("/clients", clients);
router.use("/documents", documents);
router.use("/workplans", workplans);
router.use("/quotes", quotes);
router.use("/emails", emails);
router.use("/team", team);
router.use("/permissions", permissions);
router.use("/audit", audit);
router.use("/dashboard", dashboard);
router.use("/ops", ops);
router.use("/settings", settings);
router.use("/questionnaires", questionnaires);

module.exports = router;

