const projectService = require("@/services/projectService");
const documentService = require("@/services/documentService");
const emailService = require("@/services/emailService");
const asanaService = require("@/services/asanaService");
const clientService = require("@/services/clientService");
const formSubmissionService = require("@/services/formSubmissionService");
const asanaPendingProjectsService = require("@/services/asanaPendingProjectsService");
const emailTemplateService = require("@/services/emailTemplateService");
const actionService = require("@/services/actionService");
const documentSendingService = require("@/services/documentSendingService");
const intentPromptService = require("@/services/intentPromptService");
const workplanPlannerService = require("@/services/workplanPlannerService");

module.exports = {
  ...projectService,
  ...documentService,
  ...emailService,
  ...asanaService,
  ...clientService,
  ...formSubmissionService,
  ...asanaPendingProjectsService,
  ...emailTemplateService,
  ...actionService,
  ...documentSendingService,
  ...intentPromptService,
  ...workplanPlannerService,
};
