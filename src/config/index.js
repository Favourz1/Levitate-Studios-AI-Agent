const { config } = require("dotenv");
const Joi = require("joi");

// Load environment variables
config();

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
  BASE_URL: Joi.string().uri().required(),

  // Google
  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_REDIRECT_URI: Joi.string().required(),
  GOOGLE_PRIVATE_KEY: Joi.string().required(),
  GOOGLE_CLIENT_EMAIL: Joi.string().email().required(),
  GOOGLE_PROJECT_ID: Joi.string().required(),
  GOOGLE_APPS_SCRIPT_SECRET: Joi.string().required(),

  // Brevo
  BREVO_API_KEY: Joi.string().required(),
  BREVO_WEBHOOK_SECRET: Joi.string().required(),

  // Asana
  ASANA_ACCESS_TOKEN: Joi.string().required(),
  ASANA_WORKSPACE_GID: Joi.string().required(),

  // Levitate ERP Software
  LEVITATE_ERP_BASE_URL: Joi.string().uri().required(),
  LEVITATE_ERP_API_KEY: Joi.string().required(),
  LEVITATE_ERP_API_SECRET: Joi.string().required(),
  LEVITATE_ERP_COMPANY: Joi.string().required(),

  // LLM
  OPENAI_API_KEY: Joi.string().required(),
  ANTHROPIC_API_KEY: Joi.string().optional(),

  // Tavily
  TAVILY_API_KEY: Joi.string().required(),

  // Application
  ADMIN_EMAIL: Joi.string().email().required(),
  FRONTEND_URL: Joi.string().uri().required(),
  EMAIL_DOMAIN: Joi.string().required(),
  EMAIL_REPLY_DOMAIN: Joi.string().required(),
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
    frontendUrl: envVars.FRONTEND_URL.endsWith("/")
      ? envVars.FRONTEND_URL.slice(0, -1)
      : envVars.FRONTEND_URL,
    adminEmail: envVars.ADMIN_EMAIL,
    baseUrl: envVars.BASE_URL.endsWith("/")
      ? envVars.BASE_URL.slice(0, -1)
      : envVars.BASE_URL,
  },
  google: {
    clientId: envVars.GOOGLE_CLIENT_ID,
    clientSecret: envVars.GOOGLE_CLIENT_SECRET,
    redirectUri: envVars.GOOGLE_REDIRECT_URI,
    privateKey: envVars.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    clientEmail: envVars.GOOGLE_CLIENT_EMAIL,
    projectId: envVars.GOOGLE_PROJECT_ID,
    appsScriptSecret: envVars.GOOGLE_APPS_SCRIPT_SECRET,
  },
  brevo: {
    apiKey: envVars.BREVO_API_KEY,
    webhookSecret: envVars.BREVO_WEBHOOK_SECRET,
  },
  asana: {
    accessToken: envVars.ASANA_ACCESS_TOKEN,
    workspaceGid: envVars.ASANA_WORKSPACE_GID,
  },
  erp: {
    baseUrl: envVars.LEVITATE_ERP_BASE_URL.endsWith("/")
      ? envVars.LEVITATE_ERP_BASE_URL.slice(0, -1)
      : envVars.LEVITATE_ERP_BASE_URL,
    apiKey: envVars.LEVITATE_ERP_API_KEY,
    apiSecret: envVars.LEVITATE_ERP_API_SECRET,
    company: envVars.LEVITATE_ERP_COMPANY,
  },
  llm: {
    openaiApiKey: envVars.OPENAI_API_KEY,
    anthropicApiKey: envVars.ANTHROPIC_API_KEY,
  },
  tavily: {
    apiKey: envVars.TAVILY_API_KEY,
  },
  emailDomain: envVars.EMAIL_DOMAIN,
  emailReplyDomain: envVars.EMAIL_REPLY_DOMAIN,
  logLevel: envVars.LOG_LEVEL,
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
  },
};

// Freeze the configuration to prevent accidental modifications
Object.freeze(appConfig);

module.exports = { appConfig };
