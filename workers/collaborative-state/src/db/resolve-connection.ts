/**
 * Picks the Postgres connection for a request. Admin routes use the no-cache
 * Hyperdrive config so they read their own writes; everything else uses the
 * cached pool. Falls back to a direct connection string for local dev.
 */

import type { Env } from '../env';

export interface ResolvedConnection {
  connectionString: string;
  isHyperdrive: boolean;
}

export class NoDatabaseConfiguredError extends Error {
  constructor() {
    super('No database connection configured');
    this.name = 'NoDatabaseConfiguredError';
  }
}

export function resolveConnection(env: Env, path: string): ResolvedConnection {
  const isAdminRoute = path.startsWith('/api/admin/');
  const hyperdrive = isAdminRoute && env.HYPERDRIVE_NOCACHE
    ? env.HYPERDRIVE_NOCACHE
    : env.HYPERDRIVE;

  if (hyperdrive !== undefined) {
    return { connectionString: hyperdrive.connectionString, isHyperdrive: true };
  }

  if (env.POSTGRES_CONNECTION_STRING !== undefined && env.POSTGRES_CONNECTION_STRING !== '') {
    return { connectionString: env.POSTGRES_CONNECTION_STRING, isHyperdrive: false };
  }

  throw new NoDatabaseConfiguredError();
}
