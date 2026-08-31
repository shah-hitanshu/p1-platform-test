/**
 * syncComponentRegistry
 *
 * Serialises ComponentDescriptor objects to backend documents under the
 * /_registry/ path prefix, hash-checking to skip unchanged components.
 *
 * Extracted from useComponentRegistry.ts (verbatim, renamed) so it can run
 * outside React — the browser hook and a headless CI sync script both call
 * this same function. No React import here by design.
 */

import { ConflictError } from '@pantheon-systems/css-client';
import type { P1Client } from '@pantheon-systems/css-client';
import {
  buildRegistryIndex,
  type ComponentDescriptor,
  type RegistryIndex,
} from './componentRegistry.js';

// =============================================================================
// Public API types
// =============================================================================

export interface RegistrationResult {
  registered: number;
  skipped: number;
  total: number;
}

// =============================================================================
// Registry path helpers
// =============================================================================

const REGISTRY_PREFIX = '_registry/';
export const COMPONENT_PREFIX = '_registry/components/';
export const INDEX_PATH = '_registry/index';

/**
 * Maximum age of the registry index's last full per-component verification
 * before the fast path is forced to re-verify every component's
 * actual document content instead of trusting the index's hashes map alone.
 * Bounds how long an index/document desync can persist undetected.
 */
export const REGISTRY_VERIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function componentPath(name: string): string {
  return `${COMPONENT_PREFIX}${name}`;
}

/**
 * Comparison key for matching a component name against server state.
 *
 * The server's normalizePath lowercases every document path on write, so a
 * component registered as HeroBlock lists back at _registry/components/heroblock.
 * Every in-memory lookup that matches descriptor names against path-derived
 * names (or index hash keys) must go through this key, or PascalCase components
 * never match their own documents and re-register on every load. Stored
 * formats are unchanged — index hashes stay keyed by original names, and
 * componentPath still sends the original name (the server normalizes it).
 */
function registryComponentKey(name: string): string {
  return name.toLowerCase();
}

// =============================================================================
// Core sync logic (pure async — outside React)
// =============================================================================

interface DocumentInfo {
  id: string;
  path: string;
  archived?: boolean;
}

export async function syncComponentRegistry(
  client: P1Client,
  siteId: string,
  branchId: string,
  descriptors: ComponentDescriptor[],
): Promise<RegistrationResult> {
  // Step 1: List all existing registry documents
  const existingDocs = (await client.documents.list(siteId, branchId, {
    pathPrefix: REGISTRY_PREFIX,
  })) as DocumentInfo[];

  // Step 2: Build lookup maps for existing component docs
  const docByName = new Map<string, DocumentInfo>();
  let indexDoc: DocumentInfo | undefined;
  for (const doc of existingDocs) {
    if (doc.path === INDEX_PATH) {
      indexDoc = doc;
    } else if (doc.path.startsWith(COMPONENT_PREFIX)) {
      const name = doc.path.slice(COMPONENT_PREFIX.length);
      docByName.set(registryComponentKey(name), doc);
    }
  }

  // Names that collide case-insensitively share one server document (the
  // server lowercases paths) and will silently overwrite each other.
  const namesByKey = new Map<string, string[]>();
  for (const descriptor of descriptors) {
    const key = registryComponentKey(descriptor.name);
    namesByKey.set(key, [...(namesByKey.get(key) ?? []), descriptor.name]);
  }
  for (const names of namesByKey.values()) {
    if (names.length > 1) {
      console.warn(
        '[syncComponentRegistry] Component names collide case-insensitively and will share one registry document (last write wins):',
        names,
      );
    }
  }

  // Step 3: Resolve stored hashes — fast path (from index) or legacy (per-component).
  //
  // Fast path: if the index version has a `hashes` map, read all hashes from it
  // in a single request instead of fetching each component version individually.
  // This collapses N simultaneous getLatest calls (one per component) into 1.
  //
  // Legacy fallback: index exists but has no `hashes` field (written by an older
  // version of this hook), or no index exists yet. Falls back to per-component
  // fetches so existing registries continue to work on the first run after deploy.
  const storedHashByName = new Map<string, string>();
  let gotHashesFromIndex = false;
  let existingVerifiedAt: string | undefined;

  if (indexDoc !== undefined) {
    try {
      const indexVersion = await client.versions.getLatest(siteId, branchId, indexDoc.id);
      const indexSnapshot = indexVersion.snapshot as Partial<RegistryIndex>;
      if (typeof indexSnapshot.verifiedAt === 'string') {
        existingVerifiedAt = indexSnapshot.verifiedAt;
      }
      const verifiedAtMs = existingVerifiedAt !== undefined ? Date.parse(existingVerifiedAt) : NaN;
      const verificationIsStale = !Number.isFinite(verifiedAtMs) || Date.now() - verifiedAtMs > REGISTRY_VERIFICATION_INTERVAL_MS;

      if (indexSnapshot.hashes !== undefined && typeof indexSnapshot.hashes === 'object' && !verificationIsStale) {
        for (const [name, hash] of Object.entries(indexSnapshot.hashes)) {
          if (typeof hash === 'string') {
            storedHashByName.set(registryComponentKey(name), hash);
          }
        }
        gotHashesFromIndex = true;
        console.debug('[syncComponentRegistry] Fast path: loaded', storedHashByName.size, 'hashes from index');
      } else if (verificationIsStale) {
        // PCC-3430: the fast path trusts `hashes` without ever reading the
        // documents it describes. If an entry ever comes to record a hash
        // that doesn't match its document's real content (e.g. an
        // out-of-band revert the index was never told about), the fast path
        // has no way to detect this on its own and would skip forever.
        // Periodically forcing a real per-component check bounds how long
        // such a desync can persist instead of letting it stick indefinitely.
        console.debug('[syncComponentRegistry] Registry verification is stale — forcing per-component fetch to self-heal any index/document desync');
      } else {
        console.debug('[syncComponentRegistry] Index exists but has no hashes field (legacy format) — falling back to per-component fetch');
      }
    } catch (err) {
      console.debug('[syncComponentRegistry] Index version fetch failed — falling back to per-component fetch:', err);
    }
  } else {
    console.debug('[syncComponentRegistry] No index document found — will create one after registration');
  }

  if (!gotHashesFromIndex) {
    // Legacy path: fetch each component version individually to get stored hash.
    console.debug('[syncComponentRegistry] Legacy path: fetching', docByName.size, 'component versions individually');
    await Promise.all(
      Array.from(docByName.entries()).map(async ([name, doc]) => {
        try {
          const version = await client.versions.getLatest(siteId, branchId, doc.id);
          const snapshot = version.snapshot as Partial<ComponentDescriptor>;
          if (typeof snapshot.descriptorHash === 'string') {
            storedHashByName.set(name, snapshot.descriptorHash);
          }
        } catch {
          // Version fetch failure → treat as hash mismatch, will overwrite
        }
      }),
    );
  }

  // Step 4: Write only changed/new descriptors
  let registered = 0;
  let skipped = 0;

  await Promise.all(
    descriptors.map(async (descriptor) => {
      const storedHash = storedHashByName.get(registryComponentKey(descriptor.name));
      const existingDoc = docByName.get(registryComponentKey(descriptor.name));

      // Skip only when the hash is unchanged AND the component document still
      // exists on this branch. A hash-only check is unsafe: the index can drift
      // out of sync with on-disk component docs (e.g. a partial historical
      // write, an out-of-band deletion, or branch CoW interactions where the
      // index was inherited but its referenced component docs were not). In
      // that case the index reports a matching hash for a name whose document
      // is missing, and the registry stays permanently stuck at fewer
      // components than the running config defines. Requiring `existingDoc`
      // forces the missing component through the create path on the next run,
      // which self-heals the desync and rewrites the index from the full
      // descriptor set.
      if (existingDoc !== undefined && storedHash === descriptor.descriptorHash) {
        skipped++;
        return;
      }

      let docId: string;

      if (existingDoc === undefined) {
        try {
          const newDoc = await client.documents.create({
            siteId,
            branchId,
            path: componentPath(descriptor.name),
          });
          docId = (newDoc as DocumentInfo).id;
        } catch (err) {
          if (err instanceof ConflictError) {
            const existing = await client.documents.getByPath(siteId, componentPath(descriptor.name));
            docId = (existing as DocumentInfo).id;
          } else {
            throw err;
          }
        }
      } else {
        docId = existingDoc.id;
      }

      await client.versions.create(siteId, {
        documentId: docId,
        branchId,
        snapshot: descriptor as unknown as Record<string, unknown>,
      });

      registered++;
    }),
  );

  console.debug(
    '[syncComponentRegistry] Registration complete:',
    'registered =', registered,
    'skipped =', skipped,
    'total =', descriptors.length,
    '| gotHashesFromIndex =', gotHashesFromIndex,
  );

  // Detect hash instability: if we got hashes from the index but still had to register
  // components, log which components had mismatched hashes.
  if (gotHashesFromIndex && registered > 0) {
    const changed = descriptors.filter(d => storedHashByName.get(registryComponentKey(d.name)) !== d.descriptorHash);
    console.warn(
      '[syncComponentRegistry] Hash mismatch detected for', changed.length, 'component(s) despite index being present.',
      'These components will trigger a full re-registration on every load if their hashes are unstable:',
      changed.map(d => ({ name: d.name, stored: storedHashByName.get(registryComponentKey(d.name)), computed: d.descriptorHash })),
    );
  }

  // Step 5: Write index when something changed, index doesn't exist yet, OR the existing
  // index lacks the `hashes` field (legacy format). The third condition promotes legacy
  // indexes to the fast-path format so that the next startup can skip per-component fetches.
  const indexNeedsWrite = registered > 0 || indexDoc === undefined || !gotHashesFromIndex;
  console.debug('[syncComponentRegistry] indexNeedsWrite =', indexNeedsWrite, '(registered > 0:', registered > 0, ', no indexDoc:', indexDoc === undefined, ', legacy format:', !gotHashesFromIndex, ')');

  if (indexNeedsWrite) {
    // A per-component verification just ran whenever we didn't trust the
    // fast path (missing index, legacy format, or forced by staleness) —
    // stamp verifiedAt as confirmed now. Otherwise carry the existing value
    // forward: a fast-path-only run (skips + a changed component or two)
    // doesn't verify every component's actual content, so it must not reset
    // the clock on the next forced verification.
    const verifiedAt = !gotHashesFromIndex ? new Date().toISOString() : existingVerifiedAt;
    const index: RegistryIndex = buildRegistryIndex(descriptors, siteId, branchId, verifiedAt);
    let indexDocId: string;
    if (indexDoc === undefined) {
      try {
        const newIndexDoc = await client.documents.create({ siteId, branchId, path: INDEX_PATH });
        indexDocId = (newIndexDoc as DocumentInfo).id;
      } catch (err) {
        if (err instanceof ConflictError) {
          const existing = await client.documents.getByPath(siteId, INDEX_PATH);
          indexDocId = (existing as DocumentInfo).id;
        } else {
          throw err;
        }
      }
    } else {
      indexDocId = indexDoc.id;
    }
    await client.versions.create(siteId, {
      documentId: indexDocId,
      branchId,
      snapshot: index as unknown as Record<string, unknown>,
    });
  }

  return { registered, skipped, total: descriptors.length };
}
