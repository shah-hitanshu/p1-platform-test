import { defineConfig } from 'drizzle-kit';

/**
 * The application's tables live in the `app` schema. Introspection and
 * generation are scoped to it so drizzle-kit never touches Postgres-internal
 * schemas or the drizzle-managed migration journal.
 *
 * `POSTGRES_CONNECTION_STRING` selects the target database for kit commands
 * (introspection, generate, migrate). It defaults to the local dev database.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  schemaFilter: ['app'],
  dbCredentials: {
    url:
      process.env.POSTGRES_CONNECTION_STRING ??
      'postgresql://cssuser:csspass@localhost:5432/cssdb',
  },
});
