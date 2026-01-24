/**
 * CSS Client Error Classes
 *
 * Custom error types for API and network errors.
 */

/**
 * Base error for CSS API errors.
 */
export class CSSApiError extends Error {
  override name = 'CSSApiError';
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, CSSApiError.prototype);
  }
}

/**
 * Error thrown when a network request fails.
 */
export class NetworkError extends Error {
  override name = 'NetworkError';
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.cause = cause;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Error thrown when authentication fails.
 */
export class AuthenticationError extends Error {
  override name = 'AuthenticationError';

  constructor(message: string = 'Authentication failed') {
    super(message);
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Error thrown when a resource is not found.
 */
export class NotFoundError extends CSSApiError {
  override name = 'NotFoundError';

  constructor(resource: string, id?: string) {
    const message = id ? `${resource} not found: ${id}` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND');
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when there's a conflict (e.g., duplicate resource).
 */
export class ConflictError extends CSSApiError {
  override name = 'ConflictError';

  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Error thrown when request validation fails.
 */
export class ValidationError extends CSSApiError {
  override name = 'ValidationError';

  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
