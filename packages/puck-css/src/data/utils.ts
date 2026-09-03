function hasStatus(err: unknown, status: number): boolean {
  return err instanceof Error && "status" in err && (err as { status: number }).status === status;
}

/** Returns true when the error represents a tombstoned document (HTTP 410). */
export function isDocumentGoneError(err: unknown): boolean {
  return hasStatus(err, 410);
}

/** Returns true when the error carries an HTTP 404 status, whatever the request was for. */
export function isNotFoundStatus(err: unknown): boolean {
  return hasStatus(err, 404);
}

/**
 * Thrown when a path resolves to no document. Only the path lookup itself may raise
 * this: a 404 from a later call in the same load says nothing about whether the page
 * exists, and must not be mistaken for a missing one.
 */
export class DocumentPathNotFoundError extends Error {
  override name = "DocumentPathNotFoundError";

  constructor(public readonly path: string) {
    super(`No document at path: ${path}`);
    Object.setPrototypeOf(this, DocumentPathNotFoundError.prototype);
  }
}

/** Returns true when the error represents a path with no document behind it. */
export function isDocumentNotFoundError(err: unknown): boolean {
  return err instanceof DocumentPathNotFoundError;
}

/** Safely coerce an unknown value to string — returns "" for null, undefined, and non-primitives. */
export function rawValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
