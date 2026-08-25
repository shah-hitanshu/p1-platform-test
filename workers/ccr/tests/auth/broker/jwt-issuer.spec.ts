/**
 * Broker JWT Issuer Tests (HS256 / KMS MAC)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/auth/broker/gcp-kms-client.js', () => ({
  macSign: vi.fn(),
  getPrimaryKeyVersion: vi.fn(),
  deriveKid(versionResource: string): string {
    const parts = versionResource.split('/');
    return `broker-v${parts[parts.length - 1] ?? '0'}`;
  },
}));

const KEY_RESOURCE = 'projects/p/locations/l/keyRings/r/cryptoKeys/k';
const KEY_VERSION = `${KEY_RESOURCE}/cryptoKeyVersions/42`;

describe('BrokerJwtIssuer', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('issueBrokerJwt', () => {
    it('produces a three-part JWT string', async () => {
      const { macSign, getPrimaryKeyVersion } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');

      vi.mocked(getPrimaryKeyVersion).mockResolvedValueOnce(KEY_VERSION);
      vi.mocked(macSign).mockResolvedValueOnce({
        mac: new Uint8Array([1, 2, 3]),
        keyVersion: KEY_VERSION,
      });

      const jwt = await issueBrokerJwt({
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
        issuer: 'https://css.example.com',
        subject: 'user-uuid-123',
        audience: 'css-api',
        ttlSeconds: 3600,
        siteId: 'site-123',
        email: 'user@example.com',
        name: 'Test User',
        provider: 'auth0',
      });

      const parts = jwt.split('.');
      expect(parts.length).toBe(3);
    });

    it('sets alg to HS256 and kid in the header', async () => {
      const { macSign, getPrimaryKeyVersion } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');

      vi.mocked(getPrimaryKeyVersion).mockResolvedValueOnce(KEY_VERSION);
      vi.mocked(macSign).mockResolvedValueOnce({
        mac: new Uint8Array([1, 2, 3]),
        keyVersion: KEY_VERSION,
      });

      const jwt = await issueBrokerJwt({
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
        issuer: 'https://css.example.com',
        subject: 'user-uuid-123',
        audience: 'css-api',
        ttlSeconds: 3600,
        siteId: 'site-123',
        email: 'user@example.com',
        provider: 'auth0',
      });

      const headerJson = JSON.parse(atob(jwt.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
      expect(headerJson.alg).toBe('HS256');
      expect(headerJson.typ).toBe('JWT');
      expect(headerJson.kid).toBe('broker-v42');
    });

    it('includes required claims in the payload', async () => {
      const { macSign, getPrimaryKeyVersion } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');

      vi.mocked(getPrimaryKeyVersion).mockResolvedValueOnce(KEY_VERSION);
      vi.mocked(macSign).mockResolvedValueOnce({
        mac: new Uint8Array([1, 2, 3]),
        keyVersion: KEY_VERSION,
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));

      const jwt = await issueBrokerJwt({
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
        issuer: 'https://css.example.com',
        subject: 'user-uuid-123',
        audience: 'css-api',
        ttlSeconds: 3600,
        siteId: 'site-456',
        email: 'alice@example.com',
        name: 'Alice',
        provider: 'auth0',
      });

      const payloadB64 = jwt.split('.')[1];
      const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - payloadB64.length % 4) % 4);
      const payload = JSON.parse(atob(padded));

      expect(payload.iss).toBe('https://css.example.com');
      expect(payload.sub).toBe('user-uuid-123');
      expect(payload.aud).toBe('css-api');
      expect(payload.site_id).toBe('site-456');
      expect(payload.email).toBe('alice@example.com');
      expect(payload.name).toBe('Alice');
      expect(payload.provider).toBe('auth0');
      expect(payload.iat).toBe(Math.floor(new Date('2026-05-07T12:00:00Z').getTime() / 1000));
      expect(payload.exp).toBe(Number(payload.iat) + 3600);
      expect(payload.jti).toBeDefined();

      vi.useRealTimers();
    });

    it('calls macSign exactly once with raw signing input', async () => {
      const { macSign, getPrimaryKeyVersion } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');

      vi.mocked(getPrimaryKeyVersion).mockResolvedValueOnce(KEY_VERSION);
      vi.mocked(macSign).mockResolvedValueOnce({
        mac: new Uint8Array([99]),
        keyVersion: KEY_VERSION,
      });

      await issueBrokerJwt({
        serviceAccountKeyJson: '{"key": "value"}',
        keyResource: KEY_RESOURCE,
        issuer: 'https://css.example.com',
        subject: 'sub-1',
        audience: 'css-api',
        ttlSeconds: 3600,
        siteId: 'site-1',
        email: 'a@b.com',
        provider: 'auth0',
      });

      expect(macSign).toHaveBeenCalledTimes(1);
      const [saKey, keyRes, data] = vi.mocked(macSign).mock.calls[0];
      expect(saKey).toBe('{"key": "value"}');
      expect(keyRes).toBe(KEY_RESOURCE);
      expect(data).toBeInstanceOf(Uint8Array);
      // Raw signing input (header.payload encoded as UTF-8), not a 32-byte digest
      expect(data.length).toBeGreaterThan(32);
    });

    it('includes the picture claim when avatarUrl is provided', async () => {
      const { macSign, getPrimaryKeyVersion } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');

      vi.mocked(getPrimaryKeyVersion).mockResolvedValueOnce(KEY_VERSION);
      vi.mocked(macSign).mockResolvedValueOnce({
        mac: new Uint8Array([1]),
        keyVersion: KEY_VERSION,
      });

      const jwt = await issueBrokerJwt({
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
        issuer: 'https://css.example.com',
        subject: 'sub-1',
        audience: 'css-api',
        ttlSeconds: 3600,
        siteId: 'site-1',
        email: 'alice@example.com',
        name: 'Alice',
        avatarUrl: 'https://lh3.googleusercontent.com/a/alice=s96-c',
        provider: 'auth0',
      });

      const payloadB64 = jwt.split('.')[1];
      const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - payloadB64.length % 4) % 4);
      const payload = JSON.parse(atob(padded));
      expect(payload.picture).toBe('https://lh3.googleusercontent.com/a/alice=s96-c');
    });

    it('omits picture from payload when avatarUrl is not provided', async () => {
      const { macSign, getPrimaryKeyVersion } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');

      vi.mocked(getPrimaryKeyVersion).mockResolvedValueOnce(KEY_VERSION);
      vi.mocked(macSign).mockResolvedValueOnce({
        mac: new Uint8Array([1]),
        keyVersion: KEY_VERSION,
      });

      const jwt = await issueBrokerJwt({
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
        issuer: 'https://css.example.com',
        subject: 'sub-1',
        audience: 'css-api',
        ttlSeconds: 3600,
        siteId: 'site-1',
        email: 'a@b.com',
        provider: 'auth0',
      });

      const payloadB64 = jwt.split('.')[1];
      const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - payloadB64.length % 4) % 4);
      const payload = JSON.parse(atob(padded));
      expect(payload.picture).toBeUndefined();
    });

    it('omits name from payload when not provided', async () => {
      const { macSign, getPrimaryKeyVersion } = await import('../../../src/auth/broker/gcp-kms-client.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');

      vi.mocked(getPrimaryKeyVersion).mockResolvedValueOnce(KEY_VERSION);
      vi.mocked(macSign).mockResolvedValueOnce({
        mac: new Uint8Array([1]),
        keyVersion: KEY_VERSION,
      });

      const jwt = await issueBrokerJwt({
        serviceAccountKeyJson: '{}',
        keyResource: KEY_RESOURCE,
        issuer: 'https://css.example.com',
        subject: 'sub-1',
        audience: 'css-api',
        ttlSeconds: 3600,
        siteId: 'site-1',
        email: 'a@b.com',
        provider: 'auth0',
      });

      const payloadB64 = jwt.split('.')[1];
      const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - payloadB64.length % 4) % 4);
      const payload = JSON.parse(atob(padded));
      expect(payload.name).toBeUndefined();
    });
  });
});
