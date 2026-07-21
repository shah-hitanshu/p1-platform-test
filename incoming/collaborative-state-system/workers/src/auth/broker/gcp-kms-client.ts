/**
 * GCP Cloud KMS Client
 *
 * Provides HMAC-SHA256 MAC signing via GCP Cloud KMS for token authentication.
 * Supports automatic key rotation by resolving the primary key version dynamically.
 *
 * Uses the KMS REST API directly because @google-cloud/kms depends on
 * grpc and Node built-ins that are unavailable in the Workers runtime.
 */

import { getGcpAccessToken } from '../../services/gcp-auth.js';

const KMS_SCOPE = 'https://www.googleapis.com/auth/cloudkms';
const KMS_BASE_URL = 'https://cloudkms.googleapis.com/v1';

export interface KmsMacResult {
  mac: Uint8Array;
  keyVersion: string;
}

let cachedPrimary: { keyResource: string; version: string; expiresAt: number } | null = null;

export function _resetKmsCache(): void {
  cachedPrimary = null;
}

export function deriveKid(keyVersionResource: string): string {
  const parts = keyVersionResource.split('/');
  return `broker-v${parts[parts.length - 1] ?? '0'}`;
}

export async function getPrimaryKeyVersion(
  serviceAccountKeyJson: string,
  keyResource: string,
): Promise<string> {
  if (cachedPrimary !== null && cachedPrimary.keyResource === keyResource && cachedPrimary.expiresAt > Date.now()) {
    return cachedPrimary.version;
  }

  const accessToken = await getGcpAccessToken(serviceAccountKeyJson, KMS_SCOPE);

  // Try getCryptoKey for primary version first
  const response = await fetch(`${KMS_BASE_URL}/${keyResource}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`KMS getCryptoKey failed (HTTP ${String(response.status)}): ${errorText}`);
  }

  const result: Record<string, unknown> = await response.json();
  const primary = result.primary as { name: string } | undefined;
  let version: string;

  if (primary !== undefined) {
    version = primary.name;
  } else {
    // No primary set — list versions and use the latest enabled one
    const listResponse = await fetch(
      `${KMS_BASE_URL}/${keyResource}/cryptoKeyVersions?filter=state%3DENABLED&orderBy=name+desc&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`KMS listCryptoKeyVersions failed (HTTP ${String(listResponse.status)}): ${errorText}`);
    }

    const listResult: { cryptoKeyVersions?: { name: string }[] } = await listResponse.json();
    const latest = listResult.cryptoKeyVersions?.[0];
    if (latest === undefined) {
      throw new Error('KMS: no enabled key versions found');
    }
    version = latest.name;
  }

  cachedPrimary = {
    keyResource,
    version,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };

  return version;
}

export async function macSign(
  serviceAccountKeyJson: string,
  keyResource: string,
  data: Uint8Array,
): Promise<KmsMacResult> {
  const keyVersion = await getPrimaryKeyVersion(serviceAccountKeyJson, keyResource);
  const accessToken = await getGcpAccessToken(serviceAccountKeyJson, KMS_SCOPE);

  let dataBinary = '';
  for (const byte of data) {
    dataBinary += String.fromCharCode(byte);
  }
  const dataBase64 = btoa(dataBinary);

  const response = await fetch(
    `${KMS_BASE_URL}/${keyVersion}:macSign`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: dataBase64,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`KMS macSign failed (HTTP ${String(response.status)}): ${errorText}`);
  }

  const result: { mac: string } = await response.json();
  const raw = atob(result.mac);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }

  return { mac: bytes, keyVersion };
}

export async function macVerify(
  serviceAccountKeyJson: string,
  keyVersionResource: string,
  data: Uint8Array,
  mac: Uint8Array,
): Promise<boolean> {
  const accessToken = await getGcpAccessToken(serviceAccountKeyJson, KMS_SCOPE);

  let dataBinary = '';
  for (const byte of data) {
    dataBinary += String.fromCharCode(byte);
  }
  const dataBase64 = btoa(dataBinary);

  let macBinary = '';
  for (const byte of mac) {
    macBinary += String.fromCharCode(byte);
  }
  const macBase64 = btoa(macBinary);

  const response = await fetch(
    `${KMS_BASE_URL}/${keyVersionResource}:macVerify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: dataBase64,
        mac: macBase64,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`KMS macVerify failed (HTTP ${String(response.status)}): ${errorText}`);
  }

  const result: { success: boolean } = await response.json();
  return result.success;
}
