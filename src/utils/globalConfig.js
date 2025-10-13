const { getPrismaClient, withTransaction } = require("@/database");
const { createLogger } = require("@/utils/logger");
const { ValidationError, BaseError } = require("@/utils/errors");
const { AsanaPendingProjectsBoardSections } = require("@/constants");

const logger = createLogger("utils:globalConfig");

/**
 * Utility functions for managing global configuration in the database
 * This provides a type-safe way to store and retrieve configuration values
 * that need to persist across application restarts.
 */

// Constants for configuration keys
const CONFIG_KEYS = {
  ASANA_PENDING_PROJECTS: "asana_pending_projects",
  ASANA_WORKSPACE_CONFIG: "asana_workspace_config", // not in use - we have this in env
  BREVO_SETTINGS: "brevo_settings", // not in use now
  DOCUMENT_TEMPLATES: "document_templates",
  GOOGLE_DOCUMENTS_FOLDER: "google_documents_folder",
};

/**
 * Validates configuration value structure based on key type
 * @param {string} key - Configuration key
 * @param {any} value - Configuration value to validate
 * @throws {ValidationError} If value structure is invalid
 */
const validateConfigValue = (key, value) => {
  if (!value || typeof value !== "object") {
    throw new ValidationError(
      `Configuration value for ${key} must be an object`
    );
  }

  switch (key) {
    case CONFIG_KEYS.ASANA_PENDING_PROJECTS: {
      if (!value.projectGid || typeof value.projectGid !== "string") {
        throw new ValidationError(
          "projectGid is required and must be a string"
        );
      }
      if (!value.sections || typeof value.sections !== "object") {
        throw new ValidationError("sections is required and must be an object");
      }

      // Validate required sections
      const requiredSections = [
        AsanaPendingProjectsBoardSections.FILLED_QUESTIONNAIRE,
        AsanaPendingProjectsBoardSections.BRAND_ORIGIN_DOC_PHASE,
        AsanaPendingProjectsBoardSections.BUDGET_TIMELINE_PHASE,
        AsanaPendingProjectsBoardSections.FINALIZED,
        AsanaPendingProjectsBoardSections.REJECTED,
      ];

      for (const sectionName of requiredSections) {
        if (
          !value.sections[sectionName] ||
          typeof value.sections[sectionName] !== "string"
        ) {
          throw new ValidationError(
            `Section ${sectionName} is required and must have a valid GID`
          );
        }
      }

      if (
        value.lastVerified &&
        !(value.lastVerified instanceof Date) &&
        typeof value.lastVerified !== "string"
      ) {
        throw new ValidationError(
          "lastVerified must be a Date object or ISO string if provided"
        );
      }
      break;
    }
    case CONFIG_KEYS.ASANA_WORKSPACE_CONFIG:
      if (!value.workspaceGid || typeof value.workspaceGid !== "string") {
        throw new ValidationError(
          "workspaceGid is required and must be a string"
        );
      }
      break;

    case CONFIG_KEYS.GOOGLE_DOCUMENTS_FOLDER:
      if (!value.folderId || typeof value.folderId !== "string") {
        throw new ValidationError("folderId is required and must be a string");
      }
      if (!value.folderName || typeof value.folderName !== "string") {
        throw new ValidationError(
          "folderName is required and must be a string"
        );
      }
      if (
        value.lastVerified &&
        !(value.lastVerified instanceof Date) &&
        typeof value.lastVerified !== "string"
      ) {
        throw new ValidationError(
          "lastVerified must be a Date object or ISO string if provided"
        );
      }
      break;

    default:
      // For unknown keys, just ensure it's a valid JSON object
      try {
        JSON.stringify(value);
      } catch (error) {
        throw new ValidationError(
          `Configuration value for ${key} must be JSON serializable`
        );
      }
  }
};

/**
 * Retrieves a configuration value by key
 * @param {string} key - Configuration key
 * @returns {Promise<any|null>} Configuration value or null if not found
 * @throws {ValidationError} If key is invalid
 * @throws {BaseError} If database operation fails
 */
const getConfig = async (key) => {
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    throw new ValidationError("Configuration key must be a non-empty string");
  }

  try {
    const prisma = getPrismaClient();

    const config = await prisma.globalConfig.findUnique({
      where: { key: key.trim() },
    });

    if (!config) {
      logger.debug({ key }, "Configuration not found");
      return null;
    }

    logger.debug({ key, hasValue: !!config.value }, "Configuration retrieved");
    return config.value;
  } catch (error) {
    logger.error(
      { key, error: error.message },
      "Failed to retrieve configuration"
    );
    throw new BaseError(`Failed to retrieve configuration for key: ${key}`);
  }
};

/**
 * Sets a configuration value
 * @param {string} key - Configuration key
 * @param {any} value - Configuration value (must be JSON serializable)
 * @param {string} [description] - Optional description of the configuration
 * @returns {Promise<any>} The stored configuration value
 * @throws {ValidationError} If key or value is invalid
 * @throws {BaseError} If database operation fails
 */
const setConfig = async (key, value, description = null) => {
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    throw new ValidationError("Configuration key must be a non-empty string");
  }

  if (value === undefined) {
    throw new ValidationError("Configuration value cannot be undefined");
  }

  // Validate value structure
  validateConfigValue(key.trim(), value);

  try {
    const prisma = getPrismaClient();

    const config = await prisma.globalConfig.upsert({
      where: { key: key.trim() },
      update: {
        value,
        description,
        updatedAt: new Date(),
      },
      create: {
        key: key.trim(),
        value,
        description,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info({ key, hasValue: !!config.value }, "Configuration updated");
    return config.value;
  } catch (error) {
    logger.error({ key, error: error.message }, "Failed to set configuration");
    throw new BaseError(`Failed to set configuration for key: ${key}`);
  }
};

/**
 * Updates a configuration value (alias for setConfig for clarity)
 * @param {string} key - Configuration key
 * @param {any} value - Configuration value
 * @param {string} [description] - Optional description
 * @returns {Promise<any>} The updated configuration value
 */
const updateConfig = async (key, value, description = null) => {
  return setConfig(key, value, description);
};

/**
 * Deletes a configuration by key
 * @param {string} key - Configuration key
 * @returns {Promise<boolean>} True if deleted, false if not found
 * @throws {ValidationError} If key is invalid
 * @throws {BaseError} If database operation fails
 */
const deleteConfig = async (key) => {
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    throw new ValidationError("Configuration key must be a non-empty string");
  }

  try {
    const prisma = getPrismaClient();

    const deleted = await prisma.globalConfig.delete({
      where: { key: key.trim() },
    });

    logger.info({ key }, "Configuration deleted");
    return !!deleted;
  } catch (error) {
    if (error.code === "P2025") {
      // Record not found
      logger.debug({ key }, "Configuration not found for deletion");
      return false;
    }

    logger.error(
      { key, error: error.message },
      "Failed to delete configuration"
    );
    throw new BaseError(`Failed to delete configuration for key: ${key}`);
  }
};

/**
 * Lists all configuration keys
 * @returns {Promise<string[]>} Array of configuration keys
 * @throws {BaseError} If database operation fails
 */
const listConfigKeys = async () => {
  try {
    const prisma = getPrismaClient();

    const configs = await prisma.globalConfig.findMany({
      select: { key: true },
      orderBy: { key: "asc" },
    });

    return configs.map((config) => config.key);
  } catch (error) {
    logger.error({ error: error.message }, "Failed to list configuration keys");
    throw new BaseError("Failed to list configuration keys");
  }
};

/**
 * Gets multiple configurations by keys
 * @param {string[]} keys - Array of configuration keys
 * @returns {Promise<Object>} Object with key-value pairs
 * @throws {ValidationError} If keys array is invalid
 * @throws {BaseError} If database operation fails
 */
const getMultipleConfigs = async (keys) => {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new ValidationError("Keys must be a non-empty array");
  }

  const invalidKeys = keys.filter(
    (key) => !key || typeof key !== "string" || key.trim().length === 0
  );
  if (invalidKeys.length > 0) {
    throw new ValidationError(`Invalid keys found: ${invalidKeys.join(", ")}`);
  }

  try {
    const prisma = getPrismaClient();

    const configs = await prisma.globalConfig.findMany({
      where: {
        key: {
          in: keys.map((key) => key.trim()),
        },
      },
    });

    const result = {};
    for (const config of configs) {
      result[config.key] = config.value;
    }

    // Add null values for missing keys
    for (const key of keys) {
      if (!(key.trim() in result)) {
        result[key.trim()] = null;
      }
    }

    return result;
  } catch (error) {
    logger.error(
      { keys, error: error.message },
      "Failed to retrieve multiple configurations"
    );
    throw new BaseError("Failed to retrieve multiple configurations");
  }
};

/**
 * Atomically updates multiple configurations within a transaction
 * @param {Object} configUpdates - Object with key-value pairs to update
 * @returns {Promise<Object>} Object with updated key-value pairs
 * @throws {ValidationError} If configUpdates is invalid
 * @throws {BaseError} If database operation fails
 */
const setMultipleConfigs = async (configUpdates) => {
  if (
    !configUpdates ||
    typeof configUpdates !== "object" ||
    Array.isArray(configUpdates)
  ) {
    throw new ValidationError("configUpdates must be a non-null object");
  }

  const keys = Object.keys(configUpdates);
  if (keys.length === 0) {
    throw new ValidationError("configUpdates cannot be empty");
  }

  // Validate all updates before starting transaction
  for (const [key, value] of Object.entries(configUpdates)) {
    if (!key || typeof key !== "string" || key.trim().length === 0) {
      throw new ValidationError(`Invalid key: ${key}`);
    }
    if (value === undefined) {
      throw new ValidationError(`Value for key ${key} cannot be undefined`);
    }
    validateConfigValue(key.trim(), value);
  }

  try {
    return await withTransaction(async (tx) => {
      const results = {};

      for (const [key, value] of Object.entries(configUpdates)) {
        const config = await tx.globalConfig.upsert({
          where: { key: key.trim() },
          update: {
            value,
            updatedAt: new Date(),
          },
          create: {
            key: key.trim(),
            value,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        results[key.trim()] = config.value;
      }

      logger.info(
        { keys: Object.keys(results) },
        "Multiple configurations updated"
      );
      return results;
    });
  } catch (error) {
    logger.error(
      { keys, error: error.message },
      "Failed to set multiple configurations"
    );
    throw new BaseError("Failed to set multiple configurations");
  }
};

module.exports = {
  CONFIG_KEYS,
  getConfig,
  setConfig,
  updateConfig,
  deleteConfig,
  listConfigKeys,
  getMultipleConfigs,
  setMultipleConfigs,
  validateConfigValue,
};
