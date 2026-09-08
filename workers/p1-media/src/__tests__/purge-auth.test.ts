import { describe, it, expect } from 'vitest';
import { authorizePurge, tokensMatch, PURGE_TOKEN_HEADER } from '../purge-auth';
import type { Env } from '../types';

function envWithToken(token?: string): Env {
  return { PURGE_ADMIN_TOKEN: token } as Env;
}

function reqWithHeader(value?: string): Request {
  const headers = new Headers();
  if (value !== undefined) headers.set(PURGE_TOKEN_HEADER, value);
  return new Request('https://w.example.com/media/a/purge', { method: 'POST', headers });
}

describe('tokensMatch', () => {
  it('matches equal tokens', async () => {
    expect(await tokensMatch('s3cret-token', 's3cret-token')).toBe(true);
  });

  it('rejects a different token of the same length', async () => {
    expect(await tokensMatch('s3cret-token', 's3cret-tokeX')).toBe(false);
  });

  it('rejects a prefix of the real token, in both directions', async () => {
    expect(await tokensMatch('s3cret', 's3cret-token')).toBe(false);
    expect(await tokensMatch('s3cret-token', 's3cret')).toBe(false);
  });

  it('handles unicode tokens', async () => {
    expect(await tokensMatch('пароль-秘密', 'пароль-秘密')).toBe(true);
    expect(await tokensMatch('пароль-秘密', 'пароль-秘密x')).toBe(false);
  });
});

describe('authorizePurge', () => {
  // The fail-closed cases are the entire security boundary: there is no CCR check
  // behind this gate.
  it('returns unconfigured when the secret is unset', async () => {
    expect(await authorizePurge(reqWithHeader('anything'), envWithToken(undefined))).toBe(
      'unconfigured',
    );
  });

  it('returns unconfigured when the secret is empty or whitespace', async () => {
    expect(await authorizePurge(reqWithHeader(''), envWithToken(''))).toBe('unconfigured');
    expect(await authorizePurge(reqWithHeader('   '), envWithToken('   '))).toBe('unconfigured');
  });

  it('denies when the header is missing or empty', async () => {
    expect(await authorizePurge(reqWithHeader(undefined), envWithToken('real'))).toBe('denied');
    expect(await authorizePurge(reqWithHeader(''), envWithToken('real'))).toBe('denied');
  });

  it('denies a wrong token', async () => {
    expect(await authorizePurge(reqWithHeader('wrong'), envWithToken('real'))).toBe('denied');
  });

  it('accepts the exact token', async () => {
    expect(await authorizePurge(reqWithHeader('real'), envWithToken('real'))).toBe('ok');
  });
});
