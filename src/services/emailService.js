const { createLogger } = require("@/utils/logger");

const logger = createLogger("service:email");

class EmailService {
  // Placeholder implementation
  static async sendEmail(data) {
    logger.info("Email service placeholder - sendEmail");
    return { messageId: "test-message-id", ...data };
  }

  static async processInboundEmail(data) {
    logger.info("Email service placeholder - processInboundEmail");
    return { emailId: 1, processed: true };
  }
}

module.exports = { EmailService };
