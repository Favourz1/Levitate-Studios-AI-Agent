// Import other utility modules
const logger = require("@/utils/logger");
const errors = require("@/utils/errors");
const validation = require("@/utils/validation");

const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { appConfig } = require("@/config");

// Utility functions
const generateUuid = () => uuidv4();

const generateDedupeKey = (prefix, ...parts) => {
  return `${prefix}:${parts.join(":")}:${Date.now()}`;
};

const createActionToken = (payload, expiresIn = "1h") => {
  return jwt.sign(payload, appConfig.server.jwtSecret, { expiresIn });
};

const verifyActionToken = (token) => {
  try {
    return jwt.verify(token, appConfig.server.jwtSecret);
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
};

const generateReplyToAddress = (clientId, projectId) => {
  return `clients-${clientId}-${projectId}@${appConfig.emailReplyDomain}`;
};

const parseReplyToAddress = (address) => {
  const regex = new RegExp(
    `^clients-(\\d+)-(\\d+)@${appConfig.emailReplyDomain.replace(
      /\./g,
      "\\."
    )}$`
  );
  const match = address.match(regex);

  if (!match) {
    return null;
  }

  return {
    clientId: parseInt(match[1], 10),
    projectId: parseInt(match[2], 10),
  };
};

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const retry = async (
  fn,
  maxAttempts = 3,
  delayMs = 1000,
  backoffMultiplier = 2
) => {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        break;
      }

      const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
};

const truncateText = (text, maxLength) => {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
};

const sanitizeHtml = (html) => {
  // Basic HTML sanitization - remove script tags and on* attributes
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
};

const extractTextFromHtml = (html) => {
  // Basic HTML to text conversion
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const formatCurrency = (amount, currency = "USD") => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
};

const formatDate = (date, format = "short") => {
  switch (format) {
    case "long":
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    case "iso":
      return date.toISOString();
    default:
      return date.toLocaleDateString("en-US");
  }
};

const calculateDueDate = (startDate, durationWeeks) => {
  const dueDate = new Date(startDate);
  dueDate.setDate(dueDate.getDate() + durationWeeks * 7);
  return dueDate;
};

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

const omit = (obj, keys) => {
  const result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result;
};

const pick = (obj, keys) => {
  const result = {};
  keys.forEach((key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
  });
  return result;
};

const groupBy = (array, keyFn) => {
  return array.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {});
};

const chunk = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

const debounce = (func, wait) => {
  let timeout;

  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

const throttle = (func, limit) => {
  let inThrottle;

  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};

module.exports = {
  ...logger,
  ...errors,
  ...validation,
  generateUuid,
  generateDedupeKey,
  createActionToken,
  verifyActionToken,
  generateReplyToAddress,
  parseReplyToAddress,
  sleep,
  retry,
  truncateText,
  sanitizeHtml,
  extractTextFromHtml,
  formatCurrency,
  formatDate,
  calculateDueDate,
  isValidEmail,
  isValidUrl,
  deepClone,
  omit,
  pick,
  groupBy,
  chunk,
  debounce,
  throttle,
};
