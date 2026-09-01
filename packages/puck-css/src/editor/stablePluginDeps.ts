import { useMemo, useRef } from 'react';
import type { P1FeaturePluginDeps } from '../core/plugin-types.js';

/**
 * Contributions are built from these deps once and handed to Puck as plugin
 * entries, so a new deps object per branch or user switch would remount the
 * fields panel. Reads resolve against the current values instead — see
 * `P1FeaturePluginDeps` for what that means for a contribution.
 */
export function useStablePluginDeps(deps: P1FeaturePluginDeps): P1FeaturePluginDeps {
  const latest = useRef(deps);
  latest.current = deps;

  return useMemo(
    () =>
      new Proxy({} as P1FeaturePluginDeps, {
        get: (_target, prop: PropertyKey) =>
          (latest.current as unknown as Record<PropertyKey, unknown>)[prop],
        has: (_target, prop) => prop in latest.current,
        ownKeys: () => Reflect.ownKeys(latest.current),
        // Spreading or enumerating the proxy asks for each key's descriptor, and
        // a proxy cannot report one the empty target lacks as non-configurable.
        getOwnPropertyDescriptor: (_target, prop) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(latest.current, prop);
          return descriptor && { ...descriptor, configurable: true };
        },
      }),
    [],
  );
}
