/**
 * P1 Client Error Classes
 *
 * Custom error types for API and network errors.
 */

/**
 * Base error for P1 API errors.
 */
export class P1ApiError extends Error {
  override name = 'P1ApiError';
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;
  /**
   * Correlation id for this request, echoed by the API. Quote it in a support request
   * and the server-side story for exactly this call can be found. Assigned after
   * construction so every subclass gets it without changing its constructor.
   */
  public requestId?: string;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, P1ApiError.prototype);
  }
}

/**
 * Error thrown when a network request fails.
 */
export class NetworkError extends Error {
  override name = 'NetworkError';
  public readonly cause?: Error;
  /** See {@link P1ApiError.requestId}. */
  public requestId?: string;

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
  /** See {@link P1ApiError.requestId}. */
  public requestId?: string;
  /**
   * HTTP status of the rejecting response. Absent when the failure was local
   * (no token could be obtained), so callers reporting a status must treat it
   * as optional.
   */
  public status?: number;

  constructor(message = 'Authentication failed') {
    super(message);
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Error thrown when a resource is not found.
 */
export class NotFoundError extends P1ApiError {
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
export class ConflictError extends P1ApiError {
  override name = 'ConflictError';

  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Error thrown when request validation fails.
 */
export class ValidationError extends P1ApiError {
  override name = 'ValidationError';

  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error thrown when the session has expired and cannot be refreshed.
 * Thrown when a 401 response is received and the token refresher
 * either returns null or a refreshed token that also results in 401.
 */
export class SessionExpiredError extends Error {
  override name = 'SessionExpiredError';
  /** See {@link P1ApiError.requestId}. */
  public requestId?: string;

  constructor(message = 'Session expired — please sign in again') {
    super(message);
    Object.setPrototypeOf(this, SessionExpiredError.prototype);
  }
}

/**
 * Thrown before a request leaves the client when a value destined for a URL path
 * segment is missing or empty.
 *
 * Interpolating an empty segment produces a URL the API misparses — a blank branch id
 * collapses `/branches//templates` into `/branches/templates`, and the server reports
 * "Branch not found: templates". Failing here names the parameter instead.
 *
 * The 400 is what the request would have earned, not a status the server returned: no
 * request was sent, so there is also no `requestId` to correlate against a server-side
 * log. It carries a status because callers act on one — retry wrappers in particular
 * treat a status-less error as transient and would retry a missing argument that can
 * never resolve itself.
 */
export class MissingParameterError extends P1ApiError {
  override name = 'MissingParameterError';
  /**
   * The offending argument's name, when the caller knew it. The URL backstop only sees an
   * assembled path, so it leaves this unset rather than inventing a name to report.
   */
  public readonly parameter?: string;

  constructor(parameter: string | undefined, context: string) {
    super(
      parameter !== undefined
        ? `Missing required parameter "${parameter}" for ${context}`
        : `Missing required value in ${context}`,
      400,
      'MISSING_PARAMETER',
    );
    this.parameter = parameter;
    Object.setPrototypeOf(this, MissingParameterError.prototype);
  }
}

/**
 * Stamp the correlation id onto an error and surface it in the message.
 *
 * The message is appended to on purpose: the id is only useful if a human sees it, and
 * error messages are what end up in a customer's logs and support tickets.
 */
export function attachRequestId<E extends Error>(error: E, requestId: string | undefined): E {
  if (requestId === undefined || requestId === '') return error;
  (error as E & { requestId?: string }).requestId = requestId;
  error.message = `${error.message} [request id: ${requestId}]`;
  return error;
}
