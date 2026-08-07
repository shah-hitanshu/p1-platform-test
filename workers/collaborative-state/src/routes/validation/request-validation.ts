/**
 * Request validation shared by the route handlers.
 *
 * A route declares a zod schema for its inputs and calls `validateQuery`. A failure
 * throws `RequestValidationError`, which `validationErrorResponse` renders as a 400.
 * TODO: All these will be moved into middleware once we have a router that supports it.
 */

import { z } from 'zod';
import { errorResponse } from '../../utils/http-helpers';

/**
 * Raised when a request's inputs fail their schema. The message is zod's readable
 * rendering of every failure and is safe to return to the caller; `fieldErrors`
 * carries the same failures keyed by parameter for a caller that wants to attribute
 * them.
 */
export class RequestValidationError extends Error {
  public readonly name = 'RequestValidationError';
  public readonly fieldErrors: Record<string, string[] | undefined>;

  constructor(error: z.ZodError) {
    super(z.prettifyError(error));
    this.fieldErrors = z.flattenError(error).fieldErrors;
    Object.setPrototypeOf(this, RequestValidationError.prototype);
  }
}

/**
 * Validates a request's query string against `schema`. A parameter absent from the
 * URL is absent from the parsed input, so a schema default or `.optional()` decides
 * what leaving it out means.
 *
 * @throws RequestValidationError
 */
export function validateQuery<S extends z.ZodType>(
  schema: S,
  params: URLSearchParams,
): z.infer<S> {
  const result = schema.safeParse(Object.fromEntries(params));
  if (!result.success) {
    throw new RequestValidationError(result.error);
  }
  return result.data;
}

/**
 * Validates a parsed request body against `schema`. Every failure in the body is
 * reported at once, so a caller fixing one field does not discover the next on the
 * following request.
 *
 * @throws RequestValidationError
 */
export function validateBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new RequestValidationError(result.error);
  }
  return result.data;
}

/** The 400 for a validation failure, or null when the error is something else. */
export function validationErrorResponse(error: unknown): Response | null {
  if (error instanceof RequestValidationError) {
    return errorResponse(error.message, 400, error.fieldErrors);
  }
  return null;
}
