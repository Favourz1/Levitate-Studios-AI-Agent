const projectService = require("@/services/projectService");
const documentService = require("@/services/documentService");
const emailService = require("@/services/emailService");
const asanaService = require("@/services/asanaService");
const clientService = require("@/services/clientService");

module.exports = {
  ...projectService,
  ...documentService,
  ...emailService,
  ...asanaService,
  ...clientService,
};
