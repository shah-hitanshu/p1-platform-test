/**
 * HMAC-SHA256 State Signing for OAuth flows
 *
 * The OAuth state parameter carries the original auth request so it can be
 * resumed after the Google callback. Without signing, an attacker who can
 * forge the state value could supply an arbitrary clientId/redirectUri.
 *
 * signState() encodes the payload as base64(JSON) and appends a base64url HMAC
 * signature separated by a dot: "<payload>.<sig>". This lets us split at the
 * last '.' without ambiguity, and the base64url encoding avoids '.' in the sig.
 *
 * verifyAndParseState() uses constant-time comparison to prevent timing attacks.
 *
 * Both functions accept the HMAC key as an explicit parameter — callers are
 * responsible for supplying the appropriate secret (INTERNAL_SECRET).
 */

/**
 * Signs a state payload using HMAC-SHA256 with the provided key.
 * Returns a string in the format: base64(JSON.stringify(data)).base64url(signature)
 * The dot separator allows splitting at lastIndexOf('.').
 */
export async function signState(data: object, hmacKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(hmacKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = btoa(JSON.stringify(data));
  const signature = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(payload));
  const sigBase64url = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.${sigBase64url}`;
}

/**
 * Verifies HMAC-SHA256 signature and parses the state payload.
 * Uses a constant-time comparison to prevent timing attacks.
 * Returns null if the signature is invalid or the payload cannot be parsed.
 */
export async function verifyAndParseState<T>(signedState: string, hmacKey: string): Promise<T | null> {
  const dotIndex = signedState.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const payload = signedState.substring(0, dotIndex);
  const providedSig = signedState.substring(dotIndex + 1);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(hmacKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(payload));
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // Constant-time comparison to prevent timing attacks
  if (providedSig.length !== expectedSig.length) return null;
  let diff = 0;
  for (let i = 0; i < providedSig.length; i++) {
    diff |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (diff !== 0) return null;
  try {
    return JSON.parse(atob(payload)) as T;
  } catch {
    return null;
  }
}
