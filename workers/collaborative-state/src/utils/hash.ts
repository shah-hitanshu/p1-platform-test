/**
 * Shared cryptographic utilities for bundle export/import.
 */

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute HMAC-SHA256 of data using secret, returning a hex string.
 * Used to sign and verify bundle.json so tampered bundles are rejected.
 */
export async function hmacSha256(data: Uint8Array, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
