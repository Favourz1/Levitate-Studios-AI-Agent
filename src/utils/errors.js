class BaseError extends Error {
  constructor(message, statusCode = 500, isOperational = true, context) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes
class ValidationError extends BaseError {
  constructor(message, context) {
    super(message, 400, true, context);
  }
}

class NotFoundError extends BaseError {
  constructor(resource, identifier) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, 404, true, { resource, identifier });
  }
}

class UnauthorizedError extends BaseError {
  constructor(message = "Unauthorized access") {
    super(message, 401, true);
  }
}

class ForbiddenError extends BaseError {
  constructor(message = "Forbidden access") {
    super(message, 403, true);
  }
}

class ConflictError extends BaseError {
  constructor(message, context) {
    super(message, 409, true, context);
  }
}

class RateLimitError extends BaseError {
  constructor(message = "Rate limit exceeded") {
    super(message, 429, true);
  }
}

class IntegrationError extends BaseError {
  constructor(integration, action, originalError, context) {
    const message = `${integration} integration error during ${action}`;
    super(message, 502, true, {
      integration,
      action,
      originalError: originalError?.message,
      ...context,
    });
  }
}

class JobProcessingError extends BaseError {
  constructor(jobName, originalError, context) {
    const message = `Job processing error in ${jobName}: ${originalError.message}`;
    super(message, 500, true, {
      jobName,
      originalError: originalError.message,
      ...context,
    });
  }
}

class LLMError extends BaseError {
  constructor(model, operation, originalError, context) {
    const message = `LLM error with ${model} during ${operation}`;
    super(message, 502, true, {
      model,
      operation,
      originalError: originalError?.message,
      ...context,
    });
  }
}

class DocumentError extends BaseError {
  constructor(operation, documentId, originalError) {
    const message = `Document error during ${operation}`;
    super(message, 500, true, {
      operation,
      documentId,
      originalError: originalError?.message,
    });
  }
}

class AsanaError extends IntegrationError {
  constructor(action, originalError, context) {
    super("Asana", action, originalError, context);
  }
}

class BrevoError extends IntegrationError {
  constructor(action, originalError, context) {
    super("Brevo", action, originalError, context);
  }
}

class GoogleError extends IntegrationError {
  constructor(action, originalError, context) {
    super("Google", action, originalError, context);
  }
}

class TavilyError extends IntegrationError {
  constructor(action, originalError, context) {
    super("Tavily", action, originalError, context);
  }
}

// Error handler utility functions
const isOperationalError = (error) => {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
};

const extractErrorContext = (error) => {
  if (error instanceof BaseError && error.context) {
    return error.context;
  }
  return {};
};

const createErrorResponse = (error) => {
  if (error instanceof BaseError) {
    return {
      success: false,
      error: error.message,
      message: error.message,
      statusCode: error.statusCode || 500,
      context: error.context,
    };
  }

  return {
    success: false,
    error: "Internal server error",
    message: "An error occurred",
    statusCode: 500,
  };
};

module.exports = {
  BaseError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  IntegrationError,
  JobProcessingError,
  LLMError,
  DocumentError,
  AsanaError,
  BrevoError,
  GoogleError,
  TavilyError,
  isOperationalError,
  extractErrorContext,
  createErrorResponse,
};
