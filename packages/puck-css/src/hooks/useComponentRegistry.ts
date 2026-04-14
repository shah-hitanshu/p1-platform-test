/**
 * useComponentRegistry Hook
 *
 * Runs at editor startup to serialise the Puck config into ComponentDescriptor
 * objects, hash-checks them for changes, and writes updated descriptors to CSS
 * documents under the /_registry/ path prefix.
 *
 * Uses the same CSSPuckContext pattern as useVersions, useAutoSave, and useDocuments.
 */

import { useState, useEffect } from 'react';
import { useCSSPuck } from '../CSSPuckContext.js';
import {
  extractDescriptors,
  buildRegistryIndex,
  type ComponentDescriptor,
  type RegistryIndex,
} from '../utils/componentRegistry.js';
import type { CSSClient } from '@pantheon/css-client';

// =============================================================================
// Public API types
// =============================================================================

export interface RegistrationResult {
  registered: number;
  skipped: number;
  total: number;
}

export interface UseComponentRegistryOptions {
  /** Puck config to register. Pass the same object as <Puck config={...} /> */
  puckConfig: unknown;
  /** Optional upstream Puck config for provenance classification */
  upstreamPuckConfig?: unknown;
  /** Called when registration completes (or is a full no-op) */
  onRegistered?: (result: RegistrationResult) => void;
  /** Called if registration fails */
  onError?: (error: Error) => void;
}

export interface UseComponentRegistryReturn {
  status: 'idle' | 'registering' | 'registered' | 'error';
  result: RegistrationResult | null;
  error: Error | null;
}

// =============================================================================
// Registry path helpers
// =============================================================================

const REGISTRY_PREFIX = '_registry/';
const COMPONENT_PREFIX = '_registry/components/';
const INDEX_PATH = '_registry/index';

function componentPath(name: string): string {
  return `${COMPONENT_PREFIX}${name}`;
}

// =============================================================================
// Core registration logic (pure async — outside React)
// =============================================================================

interface DocumentInfo {
  id: string;
  path: string;
  archived?: boolean;
}

async function runRegistration(
  client: CSSClient,
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
      docByName.set(name, doc);
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

  if (indexDoc !== undefined) {
    try {
      const indexVersion = await client.versions.getLatest(siteId, branchId, indexDoc.id);
      const indexSnapshot = indexVersion.snapshot as Partial<RegistryIndex>;
      if (indexSnapshot.hashes !== undefined && typeof indexSnapshot.hashes === 'object') {
        for (const [name, hash] of Object.entries(indexSnapshot.hashes)) {
          if (typeof hash === 'string') {
            storedHashByName.set(name, hash);
          }
        }
        gotHashesFromIndex = true;
      }
    } catch {
      // Index version fetch failure → fall through to per-component fetch
    }
  }

  if (!gotHashesFromIndex) {
    // Legacy path: fetch each component version individually to get stored hash.
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
      const storedHash = storedHashByName.get(descriptor.name);
      if (storedHash === descriptor.descriptorHash) {
        skipped++;
        return;
      }

      let docId: string;
      const existingDoc = docByName.get(descriptor.name);

      if (existingDoc === undefined) {
        // Create the document first
        const newDoc = await client.documents.create({
          siteId,
          branchId,
          path: componentPath(descriptor.name),
        });
        docId = (newDoc as DocumentInfo).id;
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

  // Step 5: Write index when something changed, index doesn't exist yet, OR the existing
  // index lacks the `hashes` field (legacy format). The third condition promotes legacy
  // indexes to the fast-path format so that the next startup can skip per-component fetches.
  const indexNeedsWrite = registered > 0 || indexDoc === undefined || !gotHashesFromIndex;

  if (indexNeedsWrite) {
    const index: RegistryIndex = buildRegistryIndex(descriptors, siteId, branchId);
    let indexDocId: string;
    if (indexDoc === undefined) {
      const newIndexDoc = await client.documents.create({ siteId, branchId, path: INDEX_PATH });
      indexDocId = (newIndexDoc as DocumentInfo).id;
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

// =============================================================================
// Hook
// =============================================================================

export function useComponentRegistry(
  options: UseComponentRegistryOptions,
): UseComponentRegistryReturn {
  const { puckConfig, upstreamPuckConfig, onRegistered, onError } = options;
  const { client, siteId, branchId } = useCSSPuck();

  const [status, setStatus] = useState<UseComponentRegistryReturn['status']>('idle');
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    setStatus('registering');

    const descriptors = extractDescriptors(puckConfig, upstreamPuckConfig);

    runRegistration(client, siteId, branchId, descriptors)
      .then((registrationResult) => {
        if (cancelled) return;
        setStatus('registered');
        setResult(registrationResult);
        onRegistered?.(registrationResult);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const registrationError = err instanceof Error ? err : new Error(String(err));
        setStatus('error');
        setError(registrationError);
        onError?.(registrationError);
        // Log but don't re-throw — a registry failure must not break the editor
        console.warn('[useComponentRegistry] Registration failed:', registrationError.message);
      });

    return () => {
      cancelled = true;
    };
  // Dependency array rationale:
  //   - `puckConfig` / `upstreamPuckConfig`: re-run whenever the component schema changes.
  //   - `siteId` / `branchId`: re-run when the user switches sites or branches.
  //   - `client`: intentionally omitted — CSSPuckContext provides a stable reference across renders;
  //     including it would cause spurious re-registrations on every context re-render.
  //   - `onRegistered` / `onError`: intentionally omitted — callback identity changes (e.g. from
  //     an inline arrow function) must not trigger re-registration. Callers are expected to
  //     memoize callbacks or accept that the latest callback at call-time is used.
  //   - `puckConfigRef`: not used — `puckConfig` is expected to be a stable reference from the
  //     consumer (same object passed to <Puck config={...} />). A ref guard was considered but
  //     removed because consumers that inline config objects would be broken by design; the hook
  //     documents the stable-reference expectation instead.
  // eslint-disable-next-line -- intentional omissions documented above
  }, [puckConfig, upstreamPuckConfig, siteId, branchId]);

  return { status, result, error };
}
