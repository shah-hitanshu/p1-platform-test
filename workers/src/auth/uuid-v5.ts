/**
 * UUIDv5 — Deterministic UUID generation from provider + subject ID.
 *
 * Generates stable UUIDs from OAuth provider identifiers (Google sub, Auth0 sub)
 * so they can be used in database columns that expect UUID format.
 * Same input always produces the same UUID.
 *
 * Uses SHA-1 hashing per RFC 4122 Section 4.3.
 */

/**
 * Namespace UUIDs for each auth provider.
 * These are arbitrary but fixed — changing them would break all existing mappings.
 */
const PROVIDER_NAMESPACES: Record<string, string> = {
  google: '6ba7b810-9dad-51d0-80b4-00c04fd430c8',   // Using DNS namespace as base
  auth0:  '6ba7b811-9dad-51d0-80b4-00c04fd430c8',
};

/**
 * Parse a UUID string into a 16-byte Uint8Array.
 */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Format a 16-byte array as a UUID string.
 */
function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/**
 * Generate a UUIDv5 from a namespace UUID and a name string.
 * Uses SHA-1 per RFC 4122 Section 4.3.
 */
export async function uuidV5(namespace: string, name: string): Promise<string> {
  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);

  // Concatenate namespace + name
  const data = new Uint8Array(namespaceBytes.length + nameBytes.length);
  data.set(namespaceBytes);
  data.set(nameBytes, namespaceBytes.length);

  // SHA-1 hash
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashBytes = new Uint8Array(hashBuffer);

  // Take first 16 bytes and set version/variant bits
  const uuid = new Uint8Array(16);
  uuid.set(hashBytes.subarray(0, 16));

  // Set version to 5 (bits 4-7 of byte 6)
  uuid[6] = (uuid[6] & 0x0f) | 0x50;

  // Set variant to RFC 4122 (bits 6-7 of byte 8)
  uuid[8] = (uuid[8] & 0x3f) | 0x80;

  return bytesToUuid(uuid);
}

/**
 * Generate a deterministic UUID for an OAuth provider subject ID.
 * Same provider + subjectId always produces the same UUID.
 */
export async function providerSubToUuid(
  provider: 'google' | 'auth0',
  subjectId: string,
): Promise<string> {
  const namespace = PROVIDER_NAMESPACES[provider];
  return uuidV5(namespace, subjectId);
}
