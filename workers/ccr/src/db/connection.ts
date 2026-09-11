/**
 * Connection for the one-shot database scripts: migrate, baseline and seed.
 */

import postgres from 'postgres';

export const DATABASE_URL =
  process.env.POSTGRES_CONNECTION_STRING ??
  'postgresql://cssuser:csspass@localhost:5432/cssdb';

export type Sql = ReturnType<typeof postgres>;

/**
 * Postgres objects are owned by the role that creates them. Deploys connect as
 * the IAM user but the app connects as its own role, so POSTGRES_SET_ROLE
 * switches the session to the app role for the whole script.
 */
export function createSqlConnection(): Sql {
  const role = process.env.POSTGRES_SET_ROLE;
  if (role !== undefined && role !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(role)) {
    throw new Error(
      `Invalid POSTGRES_SET_ROLE: ${role}. A role name is a letter or underscore ` +
        'followed by letters, digits or underscores.',
    );
  }
  const roleOption =
    role === undefined || role === '' ? {} : { connection: { options: `-c role=${role}` } };

  return postgres(DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
    ...roleOption,
  });
}
