/**
 * Classifies a failed database query into a small closed set of reasons.
 *
 * The failure message itself is never safe to log: postgres.js embeds the failing
 * host in `write CONNECTION_CLOSED <hash>.hyperdrive.local:5432`, and a server-side
 * constraint violation echoes column values. A reason code carries the same
 * diagnostic value with a bounded, customer-content-free vocabulary.
 */

import postgres from 'postgres';

/** Message thrown by the query race in `db.ts`, matched here to classify it. */
export const CLIENT_TIMEOUT_MESSAGE = 'Database query timed out after 20 seconds';

export type QueryFailureReason =
  | 'pool_timeout'
  | 'connection_closed'
  | 'connect_timeout'
  | 'client_timeout'
  | 'statement_error'
  | 'unknown';

export interface QueryFailure {
  reason: QueryFailureReason;
  /** SQLSTATE, only when postgres.js reported a server-side error. */
  error_code?: string;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

const POOL_TIMEOUT = /timed out while waiting for an open slot in the pool/i;
const CONNECTION_LOST = /network connection lost|connection_closed|connection closed/i;
const CONNECT_TIMEOUT = /connect_timeout|connection timed out/i;

const CODE_REASONS: Record<string, QueryFailureReason> = {
  CONNECT_TIMEOUT: 'connect_timeout',
  CONNECTION_CLOSED: 'connection_closed',
  CONNECTION_DESTROYED: 'connection_closed',
  CONNECTION_ENDED: 'connection_closed',
  CONNECTION_REFUSED: 'connection_closed',
};

export function classifyQueryFailure(error: unknown): QueryFailure {
  const message = error instanceof Error ? error.message : '';
  const code = readCode(error);

  if (message === CLIENT_TIMEOUT_MESSAGE) {
    return { reason: 'client_timeout' };
  }
  if (POOL_TIMEOUT.test(message)) {
    return { reason: 'pool_timeout' };
  }
  // Provenance, not shape: Node errno codes like EPIPE are also five uppercase
  // characters, and reporting a torn-down socket as a SQL fault is the exact
  // misdiagnosis a reason code exists to prevent.
  if (error instanceof postgres.PostgresError && code !== undefined && SQLSTATE.test(code)) {
    return { reason: 'statement_error', error_code: code };
  }
  const codeReason = code === undefined ? undefined : CODE_REASONS[code];
  if (codeReason !== undefined) {
    return { reason: codeReason };
  }
  if (CONNECT_TIMEOUT.test(message)) {
    return { reason: 'connect_timeout' };
  }
  if (CONNECTION_LOST.test(message)) {
    return { reason: 'connection_closed' };
  }
  return { reason: 'unknown' };
}

function readCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
