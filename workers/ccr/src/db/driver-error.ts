/**
 * The SQLSTATE code behind a rejected query.
 *
 * Drizzle rejects with its own error and puts the driver's error on `cause`, so
 * the code a caller matches on — `23505` for a unique violation, `23503` for a
 * foreign key — is one level down.
 *
 * The wrapper's message embeds the full statement text, which can carry customer
 * content; reading the code from here is what lets a caller branch on the failure
 * without touching the message.
 */
export function driverErrorCode(error: unknown): string | undefined {
  for (let candidate: unknown = error; candidate instanceof Error; candidate = candidate.cause) {
    if ('code' in candidate && typeof candidate.code === 'string') {
      return candidate.code;
    }
  }
  return undefined;
}

/**
 * The constraint a rejected query violated.
 *
 * Postgres names it in its own error, which the driver puts on `cause` alongside
 * the SQLSTATE. It is what tells two unique constraints on the same table apart,
 * and unlike the wrapper's message it carries no statement text.
 */
export function violatedConstraint(error: unknown): string | undefined {
  for (let candidate: unknown = error; candidate instanceof Error; candidate = candidate.cause) {
    if ('constraint_name' in candidate && typeof candidate.constraint_name === 'string') {
      return candidate.constraint_name;
    }
  }
  return undefined;
}
