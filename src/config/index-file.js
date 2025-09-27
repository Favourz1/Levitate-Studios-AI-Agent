const { config } = require("dotenv");
const Joi = require("joi");
const fs = require("fs");
const path = require("path");

// Load environment variables
config();

/**
 * Load Google IAM service account credentials from JSON file
 * @returns {Object} IAM credentials object
 */
function loadGoogleIAMCredentials() {
  try {
    const iamPath = path.join(__dirname, "iam.json");

    // Check if file exists and is readable
    try {
      fs.accessSync(iamPath, fs.constants.F_OK | fs.constants.R_OK);
    } catch (accessError) {
      throw new Error(
        `Google IAM credentials file not found or not readable at: ${iamPath}`
      );
    }

    // Read and parse JSON file with explicit error handling
    let iamFileContent;
    try {
      iamFileContent = fs.readFileSync(iamPath, "utf8");
    } catch (readError) {
      throw new Error(
        `Failed to read IAM credentials file: ${readError.message}`
      );
    }

    // Check for empty file
    if (!iamFileContent || iamFileContent.trim() === "") {
      throw new Error("Google IAM credentials file is empty");
    }

    // Parse JSON with detailed error reporting
    let iamCredentials;
    try {
      iamCredentials = JSON.parse(iamFileContent);
    } catch (parseError) {
      throw new Error(
        `Failed to parse Google IAM credentials JSON: ${parseError.message}. Please check file format.`
      );
    }

    // Validate that parsed result is an object
    if (!iamCredentials || typeof iamCredentials !== "object") {
      throw new Error("IAM credentials file must contain a JSON object");
    }

    // Validate required fields with detailed checks
    const requiredFields = ["private_key", "client_email", "project_id"];
    const missingFields = requiredFields.filter((field) => {
      const value = iamCredentials[field];
      return !value || typeof value !== "string" || value.trim() === "";
    });

    if (missingFields.length > 0) {
      throw new Error(
        `Missing or empty required fields in IAM credentials: ${missingFields.join(
          ", "
        )}`
      );
    }

    // Validate private key format with multiple checks
    const privateKey = iamCredentials.private_key.trim();
    if (
      !privateKey.includes("BEGIN PRIVATE KEY") ||
      !privateKey.includes("END PRIVATE KEY")
    ) {
      throw new Error(
        "Invalid private key format in IAM credentials. Must be a valid PEM format private key."
      );
    }

    // Validate service account email format
    const email = iamCredentials.client_email.trim();
    const emailRegex =
      /^[a-zA-Z0-9-]+@[a-zA-Z0-9-]+\.iam\.gserviceaccount\.com$/;
    if (!emailRegex.test(email)) {
      throw new Error(
        "Invalid service account email format in IAM credentials. Must follow pattern: name@project.iam.gserviceaccount.com"
      );
    }

    // Validate project ID format
    const projectId = iamCredentials.project_id.trim();
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(projectId)) {
      throw new Error(
        "Invalid project ID format in IAM credentials. Must be lowercase letters, numbers, and hyphens only."
      );
    }

    // Validate service account type
    if (iamCredentials.type && iamCredentials.type !== "service_account") {
      throw new Error(
        `Invalid credential type: ${iamCredentials.type}. Expected: service_account`
      );
    }

    return iamCredentials;
  } catch (error) {
    // Re-throw with context for debugging
    if (error.message.includes("Failed to load Google IAM credentials")) {
      throw error;
    }
    throw new Error(`Failed to load Google IAM credentials: ${error.message}`);
  }
}

// Load Google IAM credentials
const googleIAMCredentials = loadGoogleIAMCredentials();

// Validation schema
const envSchema = Joi.object({
  // Database
  DATABASE_URL: Joi.string().required(),

  // Redis
  REDIS_URL: Joi.string().required(),

  // Server
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  JWT_SECRET: Joi.string().required(),

  // Google (OAuth and Apps Script only - service account credentials loaded from iam.json)
  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_REDIRECT_URI: Joi.string().required(),
  GOOGLE_APPS_SCRIPT_SECRET: Joi.string().required(),

  // Brevo
  BREVO_API_KEY: Joi.string().required(),
  BREVO_WEBHOOK_SECRET: Joi.string().required(),

  // Asana
  ASANA_ACCESS_TOKEN: Joi.string().required(),
  ASANA_WORKSPACE_GID: Joi.string().required(),

  // LLM
  OPENAI_API_KEY: Joi.string().required(),
  ANTHROPIC_API_KEY: Joi.string().optional(),

  // Application
  ADMIN_EMAIL: Joi.string().email().required(),
  FRONTEND_URL: Joi.string().uri().required(),
  EMAIL_DOMAIN: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid("error", "warn", "info", "debug", "trace")
    .default("info"),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
}).unknown();

// Validate environment variables
const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Export configuration object
const appConfig = {
  database: {
    url: envVars.DATABASE_URL,
  },
  redis: {
    url: envVars.REDIS_URL,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
  },
  server: {
    port: envVars.PORT,
    nodeEnv: envVars.NODE_ENV,
    jwtSecret: envVars.JWT_SECRET,
    frontendUrl: envVars.FRONTEND_URL,
    adminEmail: envVars.ADMIN_EMAIL,
  },
  google: {
    // OAuth credentials from environment variables
    clientId: envVars.GOOGLE_CLIENT_ID,
    clientSecret: envVars.GOOGLE_CLIENT_SECRET,
    redirectUri: envVars.GOOGLE_REDIRECT_URI,
    appsScriptSecret: envVars.GOOGLE_APPS_SCRIPT_SECRET,
    // Service account credentials from IAM JSON file
    privateKey: googleIAMCredentials.private_key,
    clientEmail: googleIAMCredentials.client_email,
    projectId: googleIAMCredentials.project_id,
  },
  brevo: {
    apiKey: envVars.BREVO_API_KEY,
    webhookSecret: envVars.BREVO_WEBHOOK_SECRET,
  },
  asana: {
    accessToken: envVars.ASANA_ACCESS_TOKEN,
    workspaceGid: envVars.ASANA_WORKSPACE_GID,
  },
  llm: {
    openaiApiKey: envVars.OPENAI_API_KEY,
    anthropicApiKey: envVars.ANTHROPIC_API_KEY,
  },
  emailDomain: envVars.EMAIL_DOMAIN,
  logLevel: envVars.LOG_LEVEL,
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
  },
};

// Freeze the configuration to prevent accidental modifications
Object.freeze(appConfig);

module.exports = { appConfig };
