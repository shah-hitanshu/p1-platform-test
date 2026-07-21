/**
 * useComponentRegistry Hook
 *
 * Runs at editor startup to serialise the Puck config into ComponentDescriptor
 * objects, hash-checks them for changes, and writes updated descriptors to CSS
 * documents under the /_registry/ path prefix.
 *
 * Uses the same P1PuckContext pattern as useVersions, useAutoSave, and useDocuments.
 */

import { useState, useEffect } from 'react';
import { useP1Puck } from '../core/P1PuckContext.js';
import { extractDescriptors } from './utils/componentRegistry.js';
import {
  syncComponentRegistry,
  type RegistrationResult,
} from './utils/syncComponentRegistry.js';

export type { RegistrationResult } from './utils/syncComponentRegistry.js';

// =============================================================================
// Public API types
// =============================================================================

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
// Hook
// =============================================================================

export function useComponentRegistry(
  options: UseComponentRegistryOptions,
): UseComponentRegistryReturn {
  const { puckConfig, upstreamPuckConfig, onRegistered, onError } = options;
  const { client, siteId, branchId } = useP1Puck();

  const [status, setStatus] = useState<UseComponentRegistryReturn['status']>('idle');
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // branchId starts as null and resolves asynchronously. Skip registration
    // until it is available to avoid a guaranteed 404 on every page load.
    if (!branchId) return;

    let cancelled = false;

    setStatus('registering');

    const descriptors = extractDescriptors(puckConfig, upstreamPuckConfig);

    syncComponentRegistry(client, siteId, branchId, descriptors)
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
  //   - `client`: intentionally omitted — P1PuckContext provides a stable reference across renders;
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
