import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { CLIENT_TIMEOUT_MESSAGE, classifyQueryFailure } from '../src/db/query-failure';

/** Built the way postgres.js builds one, from a parsed server ErrorResponse. */
function serverError(fields: { message: string; code: string }): Error {
  return new (postgres.PostgresError as unknown as new (x: unknown) => Error)({
    severity: 'ERROR',
    ...fields,
  });
}

/**
 * The four literal messages below are the ones observed in staging during the
 * 2026-09-08 incident. They are the contract: a `query failed` line has to be
 * readable on its own, without joining against another line to recover the cause.
 */
describe('classifyQueryFailure', () => {
  it.each([
    ['Timed out while waiting for an open slot in the pool.', 'pool_timeout'],
    ['write CONNECTION_CLOSED 7e5f006b45d71013d12c66a451c834e0.hyperdrive.local:5432', 'connection_closed'],
    ['Network connection lost.', 'connection_closed'],
    [CLIENT_TIMEOUT_MESSAGE, 'client_timeout'],
  ])('maps %s to %s', (message, reason) => {
    expect(classifyQueryFailure(new Error(message))).toEqual({ reason });
  });

  it('reads the postgres.js connection code in preference to the message', () => {
    const error = Object.assign(new Error('write CONNECT_TIMEOUT db:5432'), {
      code: 'CONNECT_TIMEOUT',
    });
    expect(classifyQueryFailure(error)).toEqual({ reason: 'connect_timeout' });
  });

  it('reports a server-side failure with its SQLSTATE', () => {
    const error = serverError({
      message: 'duplicate key value violates unique constraint',
      code: '23505',
    });
    expect(classifyQueryFailure(error)).toEqual({
      reason: 'statement_error',
      error_code: '23505',
    });
  });

  /**
   * Node errno codes share the SQLSTATE shape, so the branch has to key off where
   * the error came from. Calling a dead socket a statement failure would send
   * PCC-3890's retry logic the one answer it must not retry on.
   */
  it.each(['EPIPE', 'EINTR', 'EBADF'])('does not read errno %s as a SQLSTATE', (code) => {
    const error = Object.assign(new Error('write after end'), { code });
    expect(classifyQueryFailure(error)).toEqual({ reason: 'unknown' });
  });

  it('keeps a transport code classified as transport even at SQLSTATE length', () => {
    const error = Object.assign(new Error('write EPIPE 10.0.0.1:5432'), { code: 'EPIPE' });
    expect(classifyQueryFailure(error).reason).not.toBe('statement_error');
  });

  it('classifies our own race before postgres.js gets a say', () => {
    const error = Object.assign(new Error(CLIENT_TIMEOUT_MESSAGE), { code: 'CONNECTION_CLOSED' });
    expect(classifyQueryFailure(error)).toEqual({ reason: 'client_timeout' });
  });

  it.each([
    ['an unrecognized message', new Error('something else entirely')],
    ['a non-Error throw', 'boom'],
    ['null', null],
  ])('falls back to unknown for %s', (_label, error) => {
    expect(classifyQueryFailure(error)).toEqual({ reason: 'unknown' });
  });

  /**
   * A reason is a log field, so it has to stay a closed vocabulary — the moment a
   * message fragment reaches it, the host and column values it embeds go with it.
   */
  it('never echoes the message, host, or parameter values', () => {
    const messages = [
      'write CONNECTION_CLOSED 7e5f006b45d71013d12c66a451c834e0.hyperdrive.local:5432',
      'duplicate key value violates unique constraint "sites_pkey" Key (email)=(a@b.com)',
      'Timed out while waiting for an open slot in the pool.',
    ];
    const allowed = new Set([
      'pool_timeout',
      'connection_closed',
      'connect_timeout',
      'client_timeout',
      'statement_error',
      'unknown',
    ]);
    for (const message of messages) {
      const { reason, error_code } = classifyQueryFailure(new Error(message));
      expect(allowed).toContain(reason);
      expect(error_code === undefined || /^[0-9A-Z]{5}$/.test(error_code)).toBe(true);
    }
  });
});
