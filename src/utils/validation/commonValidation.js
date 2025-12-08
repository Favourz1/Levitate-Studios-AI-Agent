// Common validation utilities that don't require logging

/**
 * General email validation helper
 * @param {string} email - Email to validate
 * @returns {boolean} True if email is valid
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== "string") {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

/**
 * Validate project phase transition
 * @param {string} fromPhase - Current phase
 * @param {string} toPhase - Target phase
 * @returns {boolean} True if transition is valid
 */
const isValidProjectPhaseTransition = (fromPhase, toPhase) => {
  if (!fromPhase || !toPhase) {
    return false;
  }

  const validTransitions = {
    null: [ProjectPhase.QUESTIONNAIRE],
    [ProjectPhase.QUESTIONNAIRE]: [
      ProjectPhase.BRAND_ORIGIN,
      ProjectPhase.REJECTED,
    ],
    [ProjectPhase.BRAND_ORIGIN]: [
      ProjectPhase.QUOTE_DOCUMENT,
      ProjectPhase.REJECTED,
    ],
    [ProjectPhase.QUOTE_DOCUMENT]: [
      ProjectPhase.ASANA_INIT,
      ProjectPhase.REJECTED,
    ],
    [ProjectPhase.ASANA_INIT]: [
      ProjectPhase.WORKPLAN_GENERATION,
      ProjectPhase.REJECTED,
    ],
    [ProjectPhase.WORKPLAN_GENERATION]: [
      ProjectPhase.FINALIZED,
      ProjectPhase.REJECTED,
    ],
    [ProjectPhase.FINALIZED]: [], // Final state
    [ProjectPhase.REJECTED]: [], // Final state
  };

  return validTransitions[fromPhase]?.includes(toPhase) || false;
};

/**
 * Validate UUID format
 * @param {string} uuid - UUID to validate
 * @returns {boolean} True if UUID is valid
 */
const isValidUUID = (uuid) => {
  if (!uuid || typeof uuid !== "string") {
    return false;
  }
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Sanitize string input to prevent XSS and injection attacks
 * @param {string} input - Input string to sanitize
 * @returns {string} Sanitized string
 */
const sanitizeString = (input) => {
  if (!input || typeof input !== "string") {
    return "";
  }

  return input
    .trim()
    .replace(/[<>]/g, "") // Remove potential HTML tags
    .replace(/['"]/g, "") // Remove quotes
    .substring(0, 1000); // Limit length
};

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if URL is valid
 */
const isValidUrl = (url) => {
  if (!url || typeof url !== "string") {
    return false;
  }

  try {
    const urlObj = new URL(url);
    return ["http:", "https:"].includes(urlObj.protocol);
  } catch {
    return false;
  }
};

/**
 * Validate phone number format (basic international format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if phone number is valid
 */
const isValidPhoneNumber = (phone) => {
  if (!phone || typeof phone !== "string") {
    return false;
  }

  // Remove all non-digit characters except +
  const cleanPhone = phone.replace(/[^\d+]/g, "");

  // Basic validation: starts with + followed by 7-15 digits
  return /^\+\d{7,15}$/.test(cleanPhone);
};

/**
 * Validate positive integer
 * @param {any} value - Value to validate
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum value (inclusive)
 * @param {number} options.max - Maximum value (inclusive)
 * @returns {boolean} True if value is a valid positive integer
 */
const isValidPositiveInteger = (value, options = {}) => {
  const { min = 1, max = Number.MAX_SAFE_INTEGER } = options;

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return false;
  }

  return value >= min && value <= max;
};

/**
 * Validate date string (ISO format)
 * @param {string} dateString - Date string to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.allowFuture - Whether to allow future dates
 * @param {boolean} options.allowPast - Whether to allow past dates
 * @returns {boolean} True if date string is valid
 */
const isValidDateString = (dateString, options = {}) => {
  const { allowFuture = true, allowPast = true } = options;

  if (!dateString || typeof dateString !== "string") {
    return false;
  }

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return false;
    }

    const now = new Date();

    if (!allowFuture && date > now) {
      return false;
    }

    if (!allowPast && date < now) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Validate string length
 * @param {string} str - String to validate
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum length
 * @param {number} options.max - Maximum length
 * @param {boolean} options.trim - Whether to trim before validation
 * @returns {boolean} True if string length is valid
 */
const isValidStringLength = (str, options = {}) => {
  const { min = 0, max = Infinity, trim = true } = options;

  if (typeof str !== "string") {
    return false;
  }

  const stringToCheck = trim ? str.trim() : str;
  return stringToCheck.length >= min && stringToCheck.length <= max;
};

/**
 * Validate alphanumeric string
 * @param {string} str - String to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.allowSpaces - Whether to allow spaces
 * @param {boolean} options.allowHyphens - Whether to allow hyphens
 * @param {boolean} options.allowUnderscores - Whether to allow underscores
 * @returns {boolean} True if string is alphanumeric
 */
const isAlphanumeric = (str, options = {}) => {
  const {
    allowSpaces = false,
    allowHyphens = false,
    allowUnderscores = false,
  } = options;

  if (!str || typeof str !== "string") {
    return false;
  }

  let pattern = "a-zA-Z0-9";
  if (allowSpaces) pattern += "\\s";
  if (allowHyphens) pattern += "\\-";
  if (allowUnderscores) pattern += "_";

  const regex = new RegExp(`^[${pattern}]+$`);
  return regex.test(str);
};

/**
 * Validate that a value is not empty
 * @param {any} value - Value to validate
 * @returns {boolean} True if value is not empty
 */
const isNotEmpty = (value) => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return true;
};

/**
 * Validate that an array contains only unique values
 * @param {Array} arr - Array to validate
 * @returns {boolean} True if array contains only unique values
 */
const hasUniqueValues = (arr) => {
  if (!Array.isArray(arr)) {
    return false;
  }

  const uniqueValues = new Set(arr);
  return uniqueValues.size === arr.length;
};

/**
 * Validate JSON string
 * @param {string} jsonString - JSON string to validate
 * @returns {boolean} True if string is valid JSON
 */
const isValidJSON = (jsonString) => {
  if (typeof jsonString !== "string") {
    return false;
  }

  try {
    JSON.parse(jsonString);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate that a value is one of the allowed values
 * @param {any} value - Value to validate
 * @param {Array} allowedValues - Array of allowed values
 * @returns {boolean} True if value is allowed
 */
const isAllowedValue = (value, allowedValues) => {
  if (!Array.isArray(allowedValues)) {
    return false;
  }

  return allowedValues.includes(value);
};

/**
 * Comprehensive validation for required fields in an object
 * @param {Object} obj - Object to validate
 * @param {Array<string>} requiredFields - Array of required field names
 * @returns {Object} Validation result with isValid boolean and missing fields array
 */
const validateRequiredFields = (obj, requiredFields) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return {
      isValid: false,
      missingFields: requiredFields,
      errors: ["Input must be a non-null object"],
    };
  }

  if (!Array.isArray(requiredFields)) {
    return {
      isValid: false,
      missingFields: [],
      errors: ["Required fields must be an array"],
    };
  }

  const missingFields = requiredFields.filter((field) => {
    const value = obj[field];
    return (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim().length === 0)
    );
  });

  return {
    isValid: missingFields.length === 0,
    missingFields,
    errors:
      missingFields.length > 0
        ? [`Missing required fields: ${missingFields.join(", ")}`]
        : [],
  };
};

module.exports = {
  isValidEmail,
  isValidProjectPhaseTransition,
  isValidUUID,
  sanitizeString,
  isValidUrl,
  isValidPhoneNumber,
  isValidPositiveInteger,
  isValidDateString,
  isValidStringLength,
  isAlphanumeric,
  isNotEmpty,
  hasUniqueValues,
  isValidJSON,
  isAllowedValue,
  validateRequiredFields,
};
