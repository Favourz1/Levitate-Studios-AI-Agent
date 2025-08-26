const { appConfig } = require("@/config");
const { BrevoError } = require("@/utils/errors");
const { createLogger, logIntegrationCall } = require("@/utils/logger");
const { retry } = require("@/utils");

const logger = createLogger("integration:brevo");

// Brevo API client
class BrevoIntegration {
  constructor() {
    this.apiKey = appConfig.brevo.apiKey;
    this.baseUrl = "https://api.brevo.com/v3";
  }

  // Generic API request method
  async makeRequest(endpoint, method = "GET", body) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "api-key": this.apiKey,
      "Content-Type": "application/json",
    };

    const config = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT")) {
      config.body = JSON.stringify(body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Brevo API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    if (response.status === 204) {
      return {}; // No content
    }

    return response.json();
  }

  // Send transactional email
  async sendTransactionalEmail(emailData) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const payload = {
            sender: {
              name: "Levitate Studios",
              email: `noreply@${appConfig.emailDomain}`,
            },
            to: emailData.to.map((email) => ({ email })),
            subject: emailData.subject,
            htmlContent: emailData.htmlContent,
            textContent: emailData.textContent,
            templateId: emailData.templateId,
            params: emailData.params,
            replyTo: emailData.replyTo
              ? { email: emailData.replyTo }
              : undefined,
          };

          return this.makeRequest("/smtp/email", "POST", payload);
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "sendTransactionalEmail",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "sendTransactionalEmail",
        false,
        duration,
        error
      );
      throw new BrevoError("sendTransactionalEmail", error, emailData);
    }
  }

  // Send email with template
  async sendTemplateEmail(templateId, to, params, replyTo) {
    return this.sendTransactionalEmail({
      to,
      subject: "", // Will be overridden by template
      templateId,
      params,
      replyTo,
    });
  }

  // Create email template
  async createEmailTemplate(name, subject, htmlContent, textContent) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const payload = {
            name,
            subject,
            htmlContent,
            textContent,
            isActive: true,
          };

          return this.makeRequest("/smtp/templates", "POST", payload);
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "createEmailTemplate",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "createEmailTemplate",
        false,
        duration,
        error
      );
      throw new BrevoError("createEmailTemplate", error, {
        name,
        subject,
      });
    }
  }

  // Get email template
  async getEmailTemplate(templateId) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.makeRequest(`/smtp/templates/${templateId}`);
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Brevo", "getEmailTemplate", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "getEmailTemplate",
        false,
        duration,
        error
      );
      throw new BrevoError("getEmailTemplate", error, { templateId });
    }
  }

  // Update email template
  async updateEmailTemplate(templateId, updates) {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          await this.makeRequest(
            `/smtp/templates/${templateId}`,
            "PUT",
            updates
          );
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "updateEmailTemplate",
        true,
        duration
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "updateEmailTemplate",
        false,
        duration,
        error
      );
      throw new BrevoError("updateEmailTemplate", error, {
        templateId,
        updates,
      });
    }
  }

  // List email templates
  async listEmailTemplates(limit = 50, offset = 0) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.makeRequest(
            `/smtp/templates?limit=${limit}&offset=${offset}`
          );
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Brevo", "listEmailTemplates", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "listEmailTemplates",
        false,
        duration,
        error
      );
      throw new BrevoError("listEmailTemplates", error, {
        limit,
        offset,
      });
    }
  }

  // Get email events (for tracking)
  async getEmailEvents(messageId, event) {
    const startTime = Date.now();

    try {
      const queryParams = new URLSearchParams({ messageId });
      if (event) {
        queryParams.append("event", event);
      }

      const result = await retry(
        async () => {
          return this.makeRequest(`/smtp/events?${queryParams.toString()}`);
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Brevo", "getEmailEvents", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "getEmailEvents",
        false,
        duration,
        error
      );
      throw new BrevoError("getEmailEvents", error, {
        messageId,
        event,
      });
    }
  }

  // Create inbound webhook
  async createInboundWebhook(
    url,
    description,
    events = ["inboundEmailProcessed"]
  ) {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          const payload = {
            url,
            description,
            events,
            type: "inbound",
          };

          return this.makeRequest("/webhooks", "POST", payload);
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "createInboundWebhook",
        true,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "createInboundWebhook",
        false,
        duration,
        error
      );
      throw new BrevoError("createInboundWebhook", error, {
        url,
        description,
        events,
      });
    }
  }

  // List webhooks
  async listWebhooks() {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.makeRequest("/webhooks");
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Brevo", "listWebhooks", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "listWebhooks",
        false,
        duration,
        error
      );
      throw new BrevoError("listWebhooks", error);
    }
  }

  // Delete webhook
  async deleteWebhook(webhookId) {
    const startTime = Date.now();

    try {
      await retry(
        async () => {
          await this.makeRequest(`/webhooks/${webhookId}`, "DELETE");
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Brevo", "deleteWebhook", true, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(
        logger,
        "Brevo",
        "deleteWebhook",
        false,
        duration,
        error
      );
      throw new BrevoError("deleteWebhook", error, { webhookId });
    }
  }

  // Get account information
  async getAccount() {
    const startTime = Date.now();

    try {
      const result = await retry(
        async () => {
          return this.makeRequest("/account");
        },
        3,
        1000
      );

      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Brevo", "getAccount", true, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logIntegrationCall(logger, "Brevo", "getAccount", false, duration, error);
      throw new BrevoError("getAccount", error);
    }
  }
}

// Create and export singleton instance
const brevoIntegration = new BrevoIntegration();

module.exports = { brevoIntegration };
