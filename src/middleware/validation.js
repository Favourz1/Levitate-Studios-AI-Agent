const { z } = require("zod");
const { ValidationError } = require("@/utils/errors");
const { createLogger } = require("@/utils/logger");

const logger = createLogger("middleware:validation");

// Validation middleware factory
const validate = (schema, source = "body") => {
  return (req, res, next) => {
    try {
      const data = req[source];
      const validatedData = schema.parse(data);

      // Replace the original data with validated data
      req[source] = validatedData;

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");

        logger.warn(
          {
            source,
            errors: error.errors,
            data: req[source],
          },
          "Validation failed"
        );

        throw new ValidationError(`Validation failed: ${message}`, {
          errors: error.errors,
          source,
        });
      }
      throw error;
    }
  };
};

// Validate request body
const validateBody = (schema) => validate(schema, "body");

// Validate query parameters
const validateQuery = (schema) => validate(schema, "query");

// Validate route parameters
const validateParams = (schema) => validate(schema, "params");

// Common parameter validation schemas
const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

// Pagination validation
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// File upload validation
const validateFileUpload = (
  allowedMimeTypes,
  maxSize = 50 * 1024 * 1024 // 50MB default
) => {
  return (req, res, next) => {
    if (!req.file && !req.files) {
      return next(); // No file uploaded, let route handler decide if required
    }

    const files = req.files
      ? Array.isArray(req.files)
        ? req.files
        : [req.files]
      : [req.file];

    for (const file of files) {
      if (!file) continue;

      // Check file size
      if (file.size > maxSize) {
        throw new ValidationError(
          `File size ${file.size} exceeds maximum allowed size of ${maxSize} bytes`,
          { filename: file.originalname, size: file.size, maxSize }
        );
      }

      // Check MIME type
      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new ValidationError(
          `File type ${
            file.mimetype
          } is not allowed. Allowed types: ${allowedMimeTypes.join(", ")}`,
          {
            filename: file.originalname,
            mimetype: file.mimetype,
            allowedMimeTypes,
          }
        );
      }
    }

    next();
  };
};

// Email validation
const emailValidationSchema = z.string().email().min(1);

// URL validation
const urlValidationSchema = z.string().url();

// Phone number validation (basic)
const phoneValidationSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format");

// Password validation
const passwordValidationSchema = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/\d/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character"
  );

// Date validation
const dateValidationSchema = z.union([
  z.string().datetime(),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  z.date(),
]);

// Common validation middleware
const validateEmail = validate(
  z.object({ email: emailValidationSchema }),
  "body"
);

const validateUrl = validate(z.object({ url: urlValidationSchema }), "body");

const validateDateRange = validate(
  z
    .object({
      startDate: dateValidationSchema,
      endDate: dateValidationSchema,
    })
    .refine(
      (data) => new Date(data.startDate) <= new Date(data.endDate),
      "Start date must be before or equal to end date"
    ),
  "query"
);

// Request sanitization
const sanitizeInput = (req, res, next) => {
  // Basic XSS prevention - strip potential script tags
  const sanitizeValue = (value) => {
    if (typeof value === "string") {
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/on\w+="[^"]*"/gi, "")
        .replace(/on\w+='[^']*'/gi, "");
    }
    if (typeof value === "object" && value !== null) {
      const sanitized = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = sanitizeValue(val);
      }
      return sanitized;
    }
    return value;
  };

  req.body = sanitizeValue(req.body);
  req.query = sanitizeValue(req.query);

  next();
};

// Content-Type validation
const requireJsonContentType = (req, res, next) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("application/json")) {
      throw new ValidationError("Content-Type must be application/json");
    }
  }
  next();
};

// Request size validation
const validateRequestSize = (maxSize = 1024 * 1024) => {
  // 1MB default
  return (req, res, next) => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);

    if (contentLength > maxSize) {
      throw new ValidationError(
        `Request size ${contentLength} exceeds maximum allowed size of ${maxSize} bytes`
      );
    }

    next();
  };
};

module.exports = {
  validate,
  validateBody,
  validateQuery,
  validateParams,
  idParamSchema,
  uuidParamSchema,
  paginationQuerySchema,
  validateFileUpload,
  emailValidationSchema,
  urlValidationSchema,
  phoneValidationSchema,
  passwordValidationSchema,
  dateValidationSchema,
  validateEmail,
  validateUrl,
  validateDateRange,
  sanitizeInput,
  requireJsonContentType,
  validateRequestSize,
};
