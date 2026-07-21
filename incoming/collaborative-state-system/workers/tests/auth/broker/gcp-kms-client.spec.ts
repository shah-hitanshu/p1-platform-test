/**
 * GCP KMS Client Tests (MAC signing)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as jose from 'jose';

let testPrivateKeyPem: string;

async function testServiceAccountKey(): Promise<string> {
  if (!testPrivateKeyPem) {
    const { privateKey } = await jose.generateKeyPair('RS256');
    testPrivateKeyPem = await jose.exportPKCS8(privateKey);
  }
  return JSON.stringify({
    client_email: 'test@project.iam.gserviceaccount.com',
    private_key: testPrivateKeyPem,
    project_id: 'test-project',
  });
}

const KEY_RESOURCE = 'projects/test-project/locations/us/keyRings/broker/cryptoKeys/jwt-signing';
const KEY_VERSION = `${KEY_RESOURCE}/cryptoKeyVersions/1`;

describe('GcpKmsClient', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { _resetKmsCache } = await import('../../../src/auth/broker/gcp-kms-client.js');
    const { _resetGcpAuthCache } = await import('../../../src/services/gcp-auth.js');
    _resetKmsCache();
    _resetGcpAuthCache();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('macSign', () => {
    it('calls GCP KMS macSign endpoint with correct parameters', async () => {
      const { macSign } = await import('../../../src/auth/broker/gcp-kms-client.js');

      const mockAccessToken = 'mock-access-token';
      const mockMac = btoa('mock-mac-bytes');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: mockAccessToken, expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ primary: { name: KEY_VERSION, state: 'ENABLED' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ mac: mockMac }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const data = new Uint8Array([1, 2, 3, 4]);

      const result = await macSign(await testServiceAccountKey(), KEY_RESOURCE, data);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [kmsUrl, kmsOpts] = mockFetch.mock.calls[2] as [string, RequestInit];
      expect(kmsUrl).toContain('cloudkms.googleapis.com');
      expect(kmsUrl).toContain(':macSign');
      expect(kmsOpts.method).toBe('POST');

      const body = JSON.parse(kmsOpts.body as string);
      expect(body.data).toBeDefined();

      expect(result.keyVersion).toBe(KEY_VERSION);
    });

    it('returns MAC bytes and key version on success', async () => {
      const { macSign } = await import('../../../src/auth/broker/gcp-kms-client.js');

      const macBytes = new Uint8Array([10, 20, 30]);
      const mockMac = btoa(String.fromCharCode(...macBytes));

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ primary: { name: KEY_VERSION, state: 'ENABLED' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ mac: mockMac }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await macSign(await testServiceAccountKey(), KEY_RESOURCE, new Uint8Array([1, 2, 3]));

      expect(result.mac).toBeInstanceOf(Uint8Array);
      expect(result.mac.length).toBeGreaterThan(0);
      expect(result.keyVersion).toBe(KEY_VERSION);
    });

    it('throws on KMS API error', async () => {
      const { macSign } = await import('../../../src/auth/broker/gcp-kms-client.js');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ primary: { name: KEY_VERSION, state: 'ENABLED' } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve('Permission denied'),
        });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        macSign(await testServiceAccountKey(), KEY_RESOURCE, new Uint8Array([1, 2, 3])),
      ).rejects.toThrow();
    });
  });

  describe('macVerify', () => {
    it('calls GCP KMS macVerify endpoint and returns true on success', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await macVerify(
        await testServiceAccountKey(),
        KEY_VERSION,
        new Uint8Array([1, 2, 3]),
        new Uint8Array([10, 20, 30]),
      );

      expect(result).toBe(true);

      const [kmsUrl, kmsOpts] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(kmsUrl).toContain(':macVerify');
      expect(kmsOpts.method).toBe('POST');

      const body = JSON.parse(kmsOpts.body as string);
      expect(body.data).toBeDefined();
      expect(body.mac).toBeDefined();
    });

    it('returns false when KMS reports verification failure', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: false }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const result = await macVerify(
        await testServiceAccountKey(),
        KEY_VERSION,
        new Uint8Array([1, 2, 3]),
        new Uint8Array([99, 99, 99]),
      );

      expect(result).toBe(false);
    });

    it('throws on KMS API error', async () => {
      const { macVerify } = await import('../../../src/auth/broker/gcp-kms-client.js');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal server error'),
        });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        macVerify(await testServiceAccountKey(), KEY_VERSION, new Uint8Array([1]), new Uint8Array([2])),
      ).rejects.toThrow();
    });
  });

  describe('deriveKid', () => {
    it('extracts version number and formats as broker-v{n}', async () => {
      const { deriveKid } = await import('../../../src/auth/broker/gcp-kms-client.js');
      expect(deriveKid(`${KEY_RESOURCE}/cryptoKeyVersions/42`)).toBe('broker-v42');
      expect(deriveKid(`${KEY_RESOURCE}/cryptoKeyVersions/1`)).toBe('broker-v1');
    });
  });
});
