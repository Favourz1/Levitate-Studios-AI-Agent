const auth = require("@/middleware/auth");
const validation = require("@/middleware/validation");
const errorHandler = require("@/middleware/errorHandler");
const logging = require("@/middleware/logging");
const cors = require("@/middleware/cors");
const rateLimit = require("@/middleware/rateLimit");

module.exports = {
  ...auth,
  ...validation,
  ...errorHandler,
  ...logging,
  ...cors,
  ...rateLimit,
};
