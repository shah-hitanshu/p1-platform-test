/**
 * Bundle Import Service (PCC-3249 / PROPOSAL-013)
 *
 * Validates and processes a site export bundle.
 * UUID remapping, SHA-256 validation, KV progress tracking.
 */
import { query } from '../db';
import type { CreatedByRef } from './bundle-export-service';
import { sha256Hex, hmacSha256 } from '../utils/hash';

export interface BundleManifest {
  bundleVersion: string;
  exportedAt: string;
  sourceEnvironment: string;
  sourceSiteId: string;
  files: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ImportProgress {
  completedPhases: string[];
  errors: string[];
  startedAt: string;
  lastUpdatedAt: string;
}

const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';
const SUPPORTED_BUNDLE_VERSION = '1';

export function buildImportKey(targetSiteId: string, exportedAt: string): string {
  return `import:${targetSiteId}:${exportedAt}`;
}

export async function validateBundleManifest(
  manifest: BundleManifest,
  fileContents: Record<string, Uint8Array>,
): Promise<ValidationResult> {
  const errors: string[] = [];

  if (manifest.bundleVersion !== SUPPORTED_BUNDLE_VERSION) {
    errors.push(
      `Unsupported bundleVersion: "${manifest.bundleVersion}". Only "${SUPPORTED_BUNDLE_VERSION}" is supported.`,
    );
    return { valid: false, errors };
  }

  for (const [filePath, expectedHash] of Object.entries(manifest.files)) {
    const content = fileContents[filePath];
    if (content === undefined) {
      errors.push(`File "${filePath}" listed in manifest but missing from bundle`);
      continue;
    }
    const actualHash = await sha256Hex(content);
    if (actualHash !== expectedHash) {
      errors.push(`SHA-256 mismatch for "${filePath}": expected ${expectedHash}, got ${actualHash}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Resolves a portable createdByRef to a local UUID in the target environment.
 * Falls back to SYSTEM_UUID when the user/agent is not found.
 */
export async function resolveCreatedByRefToId(ref: CreatedByRef): Promise<string> {
  if (ref.type === 'system') return SYSTEM_UUID;

  if (ref.type === 'user') {
    if (ref.email == null || ref.email === '') return SYSTEM_UUID;
    const result = await query<{ id: string }>(
      'SELECT id FROM app.users WHERE email = $1',
      [ref.email],
    );
    const row = result.rows[0];
    if (row == null) {
      console.warn(`[bundle-import] User "${ref.email}" not found — attribution set to system`);
      return SYSTEM_UUID;
    }
    return row.id;
  }

  // agent
  if (ref.name == null || ref.name === '') return SYSTEM_UUID;
  const result = await query<{ id: string }>(
    'SELECT id FROM app.agents WHERE name = $1',
    [ref.name],
  );
  const row = result.rows[0];
  if (row == null) {
    console.warn(`[bundle-import] Agent "${ref.name}" not found — attribution set to system`);
    return SYSTEM_UUID;
  }
  return row.id;
}

export async function getImportProgress(
  kv: KVNamespace,
  importKey: string,
): Promise<ImportProgress | null> {
  const raw = await kv.get(importKey);
  if (raw === null) return null;
  return JSON.parse(raw) as ImportProgress;
}

export async function saveImportProgress(
  kv: KVNamespace,
  importKey: string,
  progress: ImportProgress,
): Promise<void> {
  await kv.put(importKey, JSON.stringify(progress), { expirationTtl: 7 * 24 * 60 * 60 });
}

export function hasCompletedPhase(progress: ImportProgress | null, phase: string): boolean {
  return progress?.completedPhases.includes(phase) ?? false;
}

/**
 * Verifies the HMAC-SHA256 signature of bundle.json produced by signBundleJson().
 * Uses constant-time comparison to prevent timing attacks.
 * Returns true if the signature is valid, false if tampered or wrong secret.
 */
export async function verifyBundleSignature(
  bundleJsonBytes: Uint8Array,
  providedSignature: string,
  internalSecret: string,
): Promise<boolean> {
  const expected = await hmacSha256(bundleJsonBytes, internalSecret);
  const expectedBytes = new TextEncoder().encode(expected);
  const providedBytes = new TextEncoder().encode(providedSignature);
  if (expectedBytes.length !== providedBytes.length) return false;
  return crypto.subtle.timingSafeEqual(expectedBytes, providedBytes);
}

// sha256Hex is imported from utils/hash and used in validateBundleManifest above.
