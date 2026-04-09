import crypto from "crypto";

/**
 * Structured API error that is safe to serialize to clients.
 *
 * Usage:
 *   throw new ApiError(409, "REFINEMENT_ALREADY_USED", "Enhancement already consumed.");
 *   throw ApiError.internal("Something broke");  // 500, generic message to client
 */
export class ApiError extends Error {
  /**
   * @param {number}  status    HTTP status code
   * @param {string}  code      Machine-readable error code (UPPER_SNAKE_CASE)
   * @param {string}  message   Human-readable message safe for the client
   * @param {object}  [opts]
   * @param {boolean} [opts.retryable=false]
   * @param {object}  [opts.details]   Structured context for the frontend
   * @param {string}  [opts.internal]  Internal-only message (logged, never sent)
   */
  constructor(status, code, message, opts = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details ?? null;
    this.internalMessage = opts.internal ?? null;
  }

  static badRequest(message, code = "BAD_REQUEST", details) {
    return new ApiError(400, code, message, { details });
  }

  static unauthorized(message = "Authentication required.", code = "UNAUTHORIZED") {
    return new ApiError(401, code, message);
  }

  static forbidden(message = "Access denied.", code = "FORBIDDEN") {
    return new ApiError(403, code, message);
  }

  static notFound(message = "Resource not found.", code = "NOT_FOUND") {
    return new ApiError(404, code, message);
  }

  static conflict(message, code = "CONFLICT", details) {
    return new ApiError(409, code, message, { details });
  }

  static tooMany(message = "Too many requests. Please try again later.") {
    return new ApiError(429, "RATE_LIMITED", message, { retryable: true });
  }

  static internal(internalMsg) {
    return new ApiError(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      { retryable: true, internal: internalMsg },
    );
  }
}

/**
 * Generate a short request ID for tracing (attached to every error response).
 */
export function generateRequestId() {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Format any error into the standard API envelope.
 * Ensures internal details (stack traces, raw messages from third-party
 * services) are never leaked to the client.
 */
export function formatErrorResponse(err, requestId) {
  if (err instanceof ApiError) {
    return {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      ...(err.details ? { details: err.details } : {}),
      requestId,
    };
  }

  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors || {}).map((e) => e.message);
    return {
      code: "VALIDATION_ERROR",
      message: messages.join(", "),
      retryable: false,
      requestId,
    };
  }

  if (err.name === "CastError") {
    return {
      code: "INVALID_PARAMETER",
      message: `Invalid value for field: ${err.path}`,
      retryable: false,
      requestId,
    };
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? "field";
    return {
      code: "DUPLICATE_VALUE",
      message: `${field} is already in use.`,
      retryable: false,
      requestId,
    };
  }

  const status = err.status || 500;
  const isServer = status >= 500;

  return {
    code: isServer ? "INTERNAL_ERROR" : "ERROR",
    message: isServer
      ? "An unexpected error occurred. Please try again later."
      : err.message || "Something went wrong.",
    retryable: isServer,
    requestId,
  };
}
