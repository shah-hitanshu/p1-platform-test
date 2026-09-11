import { describe, it, expect } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { isConnectionError } from '../src/db';

describe('isConnectionError', () => {
  it('recognises a driver error the caller catches directly', () => {
    expect(isConnectionError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true);
  });

  it('recognises a driver error Drizzle wrapped', () => {
    const wrapped = new DrizzleQueryError(
      'select * from app.sites',
      [],
      new Error('write ECONNRESET'),
    );
    expect(isConnectionError(wrapped)).toBe(true);
  });

  it('leaves a query error alone however it arrives', () => {
    const constraint = new Error('null value in column "name" violates not-null constraint');
    expect(isConnectionError(constraint)).toBe(false);
    expect(isConnectionError(new DrizzleQueryError('insert into app.sites', [], constraint))).toBe(false);
  });

  it('is false for anything that is not an error', () => {
    expect(isConnectionError('connection refused')).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });
});
