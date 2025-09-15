const { ValidationError } = require("@/utils/errors");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("utils:form-validation");

/**
 * Comprehensive form payload validation with support for complex Google Form field types
 * @param {Object} payload - Form submission payload
 * @returns {boolean} True if payload is valid
 * @throws {ValidationError} If validation fails
 */
const validateFormPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("Payload must be a non-null object");
  }

  // Required top-level fields
  const requiredFields = ["responseId", "timestamp", "responses", "metadata"];
  const missingFields = requiredFields.filter(
    (field) =>
      !Object.prototype.hasOwnProperty.call(payload, field) ||
      payload[field] == null
  );

  if (missingFields.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missingFields.join(", ")}`
    );
  }

  // Validate responseId format
  if (
    typeof payload.responseId !== "string" ||
    payload.responseId.trim().length === 0
  ) {
    throw new ValidationError("responseId must be a non-empty string");
  }

  // Validate timestamp format (should be ISO string)
  if (typeof payload.timestamp !== "string") {
    throw new ValidationError("timestamp must be a string");
  }

  try {
    const date = new Date(payload.timestamp);
    if (isNaN(date.getTime())) {
      throw new ValidationError("timestamp must be a valid ISO date string");
    }
  } catch (e) {
    throw new ValidationError("timestamp must be a valid ISO date string");
  }

  // Validate responses object (can be empty but must be an object)
  if (
    typeof payload.responses !== "object" ||
    Array.isArray(payload.responses)
  ) {
    throw new ValidationError("responses must be an object");
  }

  // Validate complex form response types that Google Forms can generate
  for (const [questionTitle, response] of Object.entries(payload.responses)) {
    if (
      typeof questionTitle !== "string" ||
      questionTitle.trim().length === 0
    ) {
      throw new ValidationError(`Invalid question title: ${questionTitle}`);
    }

    // Allow various response types that Google Forms can generate:
    // - null/undefined for unanswered questions
    // - string for text responses
    // - array for checkbox/multiple choice
    // - object for grid responses
    // - numbers for scale responses
    if (response !== null && response !== undefined) {
      if (typeof response === "object" && !Array.isArray(response)) {
        // Grid responses - validate structure
        if (Object.keys(response).length > 0) {
          for (const [rowKey, rowValue] of Object.entries(response)) {
            if (typeof rowKey !== "string") {
              throw new ValidationError(
                `Invalid grid row key in "${questionTitle}": ${rowKey}`
              );
            }
            // Grid values can be strings, arrays, or null
            if (
              rowValue !== null &&
              typeof rowValue !== "string" &&
              !Array.isArray(rowValue)
            ) {
              throw new ValidationError(
                `Invalid grid value type in "${questionTitle}" for row "${rowKey}"`
              );
            }
          }
        }
      } else if (Array.isArray(response)) {
        // Array responses (checkboxes, file uploads, etc.)
        response.forEach((item, index) => {
          if (typeof item === "object" && item !== null) {
            // File upload objects
            if (
              !Object.prototype.hasOwnProperty.call(item, "id") &&
              !Object.prototype.hasOwnProperty.call(item, "url") &&
              !Object.prototype.hasOwnProperty.call(item, "name")
            ) {
              // Allow objects but validate they have some expected structure
              const keys = Object.keys(item);
              if (keys.length === 0) {
                throw new ValidationError(
                  `Empty object in responses array for "${questionTitle}" at index ${index}`
                );
              }
            }
          } else if (
            typeof item !== "string" &&
            typeof item !== "number" &&
            item !== null
          ) {
            throw new ValidationError(
              `Invalid item type in responses array for "${questionTitle}" at index ${index}`
            );
          }
        });
      } else if (
        typeof response !== "string" &&
        typeof response !== "number" &&
        typeof response !== "boolean"
      ) {
        throw new ValidationError(
          `Invalid response type for "${questionTitle}": ${typeof response}`
        );
      }
    }
  }

  // Validate metadata structure
  if (
    !payload.metadata ||
    typeof payload.metadata !== "object" ||
    Array.isArray(payload.metadata)
  ) {
    throw new ValidationError("metadata must be an object");
  }

  // Required metadata fields
  const requiredMetadata = ["formId", "formTitle"];
  const missingMetadata = requiredMetadata.filter(
    (field) =>
      !Object.prototype.hasOwnProperty.call(payload.metadata, field) ||
      payload.metadata[field] == null ||
      (typeof payload.metadata[field] === "string" &&
        payload.metadata[field].trim().length === 0)
  );

  if (missingMetadata.length > 0) {
    throw new ValidationError(
      `Missing required metadata fields: ${missingMetadata.join(", ")}`
    );
  }

  // Validate metadata field types
  if (typeof payload.metadata.formId !== "string") {
    throw new ValidationError("metadata.formId must be a string");
  }

  if (typeof payload.metadata.formTitle !== "string") {
    throw new ValidationError("metadata.formTitle must be a string");
  }

  // Validate optional fields if present
  if (
    payload.respondentEmail !== null &&
    payload.respondentEmail !== undefined
  ) {
    if (typeof payload.respondentEmail !== "string") {
      throw new ValidationError(
        "respondentEmail must be a string when provided"
      );
    }
    // Basic email format check
    if (
      payload.respondentEmail.trim().length > 0 &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.respondentEmail)
    ) {
      throw new ValidationError(
        "respondentEmail must be a valid email format when provided"
      );
    }
  }

  logger.debug({
    message: "Form payload validation successful",
    formId: payload.metadata.formId,
    formTitle: payload.metadata.formTitle,
    responseId: payload.responseId,
    responseCount: Object.keys(payload.responses).length,
    hasRespondentEmail: !!payload.respondentEmail,
  });

  return true;
};

/**
 * Validate form response data structure
 * @param {Object} responses - Form responses object
 * @returns {boolean} True if responses are valid
 * @throws {ValidationError} If validation fails
 */
const validateFormResponses = (responses) => {
  if (!responses || typeof responses !== "object" || Array.isArray(responses)) {
    throw new ValidationError("Form responses must be an object");
  }

  // Check for empty responses
  if (Object.keys(responses).length === 0) {
    logger.warn("Form submitted with no responses");
    return true; // Allow empty responses but log warning
  }

  // Validate each response entry
  for (const [question, answer] of Object.entries(responses)) {
    if (typeof question !== "string" || question.trim().length === 0) {
      throw new ValidationError(`Invalid question format: ${question}`);
    }

    // Answer can be null, string, number, boolean, array, or object
    if (answer !== null && answer !== undefined) {
      const answerType = typeof answer;
      if (!["string", "number", "boolean", "object"].includes(answerType)) {
        throw new ValidationError(
          `Invalid answer type for question "${question}": ${answerType}`
        );
      }
    }
  }

  return true;
};

/**
 * Validate form metadata structure
 * @param {Object} metadata - Form metadata object
 * @returns {boolean} True if metadata is valid
 * @throws {ValidationError} If validation fails
 */
const validateFormMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ValidationError("Form metadata must be an object");
  }

  const requiredFields = ["formId", "formTitle"];
  for (const field of requiredFields) {
    if (!metadata[field] || typeof metadata[field] !== "string") {
      throw new ValidationError(`metadata.${field} must be a non-empty string`);
    }
  }

  // Validate formId format (should be alphanumeric with possible hyphens/underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(metadata.formId)) {
    throw new ValidationError("metadata.formId contains invalid characters");
  }

  return true;
};

/**
 * Validate form timestamp
 * @param {string} timestamp - ISO timestamp string
 * @returns {boolean} True if timestamp is valid
 * @throws {ValidationError} If validation fails
 */
const validateFormTimestamp = (timestamp) => {
  if (!timestamp || typeof timestamp !== "string") {
    throw new ValidationError("Timestamp must be a non-empty string");
  }

  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      throw new ValidationError("Invalid timestamp format");
    }

    // Check if timestamp is not too far in the future (1 hour buffer)
    const now = new Date();
    const maxFutureTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

    if (date > maxFutureTime) {
      throw new ValidationError(
        "Timestamp cannot be more than 1 hour in the future"
      );
    }

    // Check if timestamp is not too old (1 week buffer)
    const minPastTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 1 week ago

    if (date < minPastTime) {
      logger.warn({
        message: "Form submission timestamp is older than 1 week",
        timestamp,
        submittedDate: date.toISOString(),
      });
    }

    return true;
  } catch (error) {
    throw new ValidationError(`Invalid timestamp: ${error.message}`);
  }
};

/**
 * Validate response ID format
 * @param {string} responseId - Response ID to validate
 * @returns {boolean} True if response ID is valid
 * @throws {ValidationError} If validation fails
 */
const validateResponseId = (responseId) => {
  if (!responseId || typeof responseId !== "string") {
    throw new ValidationError("Response ID must be a non-empty string");
  }

  // Trim and check length
  const trimmedId = responseId.trim();
  if (trimmedId.length === 0) {
    throw new ValidationError("Response ID cannot be empty or just whitespace");
  }

  // Check for reasonable length limits
  if (trimmedId.length > 255) {
    throw new ValidationError("Response ID is too long (max 255 characters)");
  }

  // Validate format (alphanumeric with hyphens, underscores, and dots allowed)
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmedId)) {
    throw new ValidationError("Response ID contains invalid characters");
  }

  return true;
};

module.exports = {
  validateFormPayload,
  validateFormResponses,
  validateFormMetadata,
  validateFormTimestamp,
  validateResponseId,
};
