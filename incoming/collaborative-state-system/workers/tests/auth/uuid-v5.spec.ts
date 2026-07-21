/**
 * UUIDv5 Tests
 *
 * Tests for deterministic UUID generation from provider + subject ID.
 */

import { describe, it, expect } from 'vitest';
import { uuidV5, providerSubToUuid } from '../../src/auth/uuid-v5';

describe('uuidV5', () => {
  it('should generate a valid UUID format', async () => {
    const result = await uuidV5('6ba7b810-9dad-51d0-80b4-00c04fd430c8', 'test');
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('should produce deterministic output (same input = same UUID)', async () => {
    const a = await uuidV5('6ba7b810-9dad-51d0-80b4-00c04fd430c8', 'hello');
    const b = await uuidV5('6ba7b810-9dad-51d0-80b4-00c04fd430c8', 'hello');
    expect(a).toBe(b);
  });

  it('should produce different UUIDs for different names', async () => {
    const ns = '6ba7b810-9dad-51d0-80b4-00c04fd430c8';
    const a = await uuidV5(ns, 'alice');
    const b = await uuidV5(ns, 'bob');
    expect(a).not.toBe(b);
  });

  it('should produce different UUIDs for different namespaces', async () => {
    const a = await uuidV5('6ba7b810-9dad-51d0-80b4-00c04fd430c8', 'test');
    const b = await uuidV5('6ba7b811-9dad-51d0-80b4-00c04fd430c8', 'test');
    expect(a).not.toBe(b);
  });

  it('should set version bits to 5', async () => {
    const result = await uuidV5('6ba7b810-9dad-51d0-80b4-00c04fd430c8', 'test');
    // Version is the first character of the 3rd group
    expect(result.split('-')[2][0]).toBe('5');
  });

  it('should set variant bits to RFC 4122', async () => {
    const result = await uuidV5('6ba7b810-9dad-51d0-80b4-00c04fd430c8', 'test');
    // Variant is the first character of the 4th group, should be 8, 9, a, or b
    const variantChar = result.split('-')[3][0];
    expect(['8', '9', 'a', 'b']).toContain(variantChar);
  });
});

describe('providerSubToUuid', () => {
  it('should generate a valid UUID for a Google subject', async () => {
    const result = await providerSubToUuid('google', '110402054196644394871');
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('should generate a valid UUID for an Auth0 subject', async () => {
    const result = await providerSubToUuid('auth0', 'auth0|abc123');
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('should be deterministic for the same provider and subject', async () => {
    const a = await providerSubToUuid('google', '110402054196644394871');
    const b = await providerSubToUuid('google', '110402054196644394871');
    expect(a).toBe(b);
  });

  it('should produce different UUIDs for same subject across providers', async () => {
    const google = await providerSubToUuid('google', 'same-sub');
    const auth0 = await providerSubToUuid('auth0', 'same-sub');
    expect(google).not.toBe(auth0);
  });
});
