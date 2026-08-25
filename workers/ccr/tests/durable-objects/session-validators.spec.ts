/**
 * Tests for actorId validation.
 *
 * Realtime actorIds are the authenticated principal's id / OAuth subject, which
 * for Auth0/Google logins looks like `google-oauth2|<digits>` — i.e. it contains
 * a "|". The connect path cross-validates actorId against the authenticated
 * identity (realtime-api), so the charset check must permit the characters that
 * real OAuth subjects contain, or realtime is unusable for every OAuth user.
 */

import { describe, it, expect } from 'vitest';
import { validateActorId } from '../../src/durable-objects/session-validators';

describe('validateActorId', () => {
  it('accepts alphanumeric, hyphen, and underscore ids', () => {
    expect(validateActorId('user-123_abc')).toBeNull();
    expect(validateActorId('11111111-1111-1111-1111-111111111111')).toBeNull();
  });

  it('accepts OAuth subject ids containing "|" (Auth0/Google)', () => {
    expect(validateActorId('google-oauth2|106676111009080219481')).toBeNull();
    expect(validateActorId('auth0|abc123')).toBeNull();
  });

  it('rejects ids with other disallowed characters', () => {
    expect(validateActorId('has space')).not.toBeNull();
    expect(validateActorId('slash/here')).not.toBeNull();
    expect(validateActorId('<script>')).not.toBeNull();
  });

  it('rejects ids exceeding the maximum length', () => {
    expect(validateActorId('a'.repeat(10000))).not.toBeNull();
  });
});
