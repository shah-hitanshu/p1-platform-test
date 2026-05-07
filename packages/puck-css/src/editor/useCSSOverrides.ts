/**
 * useCSSOverrides Hook
 *
 * Creates referentially stable Puck overrides for CSS integration.
 * Internally reads getters and callbacks from CSSPuckProvider context
 * and wires them to createCSSOverrides with correct options.
 */

import { useRef, useMemo } from 'react';
import { useCSSPuck } from '../core/CSSPuckContext.js';
import { createCSSOverrides } from './plugin/createCSSOverrides.js';
import type { CSSOverridesOptions, PuckOverrides } from './plugin/createCSSOverrides.js';
import type { Checkpoint, ActorPresence } from '@pantheon-systems/css-client';

/**
 * Options consumers can pass to customize override behavior.
 */
export interface UseCSSOverridesOptions {
  /** Whether to show the default Puck publish button */
  showDefaultPublish?: boolean;
  /** Callback when publish succeeds */
  onPublishSuccess?: (checkpoint: Checkpoint) => void;
  /** Callback when publish fails */
  onPublishError?: (error: Error) => void;
  /** Callback when stop agent button is clicked */
  onStopAgent?: (agent: ActorPresence) => void;
  /** Whether to show collaborator avatars in header */
  showCollaboratorAvatars?: boolean;
  /** Whether to show agent activity banner in header */
  showAgentActivityBanner?: boolean;
  /** Published status for the header badge */
  publishedStatus?: 'published' | 'unpublished-changes' | 'draft';
}

/**
 * Creates referentially stable Puck overrides for CSS integration.
 *
 * Reads stable getters and callbacks from CSSPuckProvider context and
 * wires them to createCSSOverrides. Uses a Proxy pattern to keep the
 * overrides object referentially stable across re-renders.
 *
 * Must be used inside a CSSPuckProvider.
 *
 * @param options - Optional customization
 * @returns Stable PuckOverrides instance
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const overrides = useCSSOverrides({
 *     onPublishSuccess: (cp) => console.log('Published:', cp.name),
 *   });
 *   return <Puck overrides={overrides} config={config} data={data} />;
 * }
 * ```
 */
export function useCSSOverrides(options: UseCSSOverridesOptions = {}): PuckOverrides {
  const css = useCSSPuck();

  // Build the full overrides options from context + consumer options
  const fc = css.featureConfig;

  const overridesOptions: CSSOverridesOptions = {
    // Use getter-based API for performance (avoids overrides recreation)
    getSaveStatus: css.getSaveStatus,
    getLastSaved: css.getLastSaved,
    getSaveError: css.getSaveError,
    onRetrySave: css.saveNow,
    showDefaultPublish: options.showDefaultPublish,
    showSaveIndicator: fc?.enableAutoSave ?? true,
    isViewingHistoricalVersion: css.isViewingHistoricalVersion,
    viewingVersion: css.viewingVersion,
    onReturnToLatest: css.returnToLatest,
    // Presence/Agent features — gated by featureConfig flags
    showCollaboratorAvatars: options.showCollaboratorAvatars
      ?? ((fc?.enableCollaboratorAvatars ?? true) && css.presence !== null),
    presence: (fc?.enableCollaboratorAvatars ?? true) ? css.presence?.actors : undefined,
    showAgentActivityBanner: options.showAgentActivityBanner
      ?? ((fc?.enableAgentBanner ?? true) && css.hasActiveAgents),
    activeAgents: (fc?.enableAgentBanner ?? true)
      ? css.presence?.agents?.filter(a => a.state === 'editing')
      : undefined,
    isAgentEditing: (fc?.enableAgentBanner ?? true) && css.hasActiveAgents,
    onStopAgent: options.onStopAgent ?? css.stopAgent,
    publishedStatus: options.publishedStatus,
  };

  // Store options in a ref updated each render
  const optionsRef = useRef(overridesOptions);
  optionsRef.current = overridesOptions;

  // Create a stable Proxy-backed options object
  const stableOptions = useMemo(
    () =>
      new Proxy({} as CSSOverridesOptions, {
        get(_target, prop: string) {
          return (optionsRef.current as unknown as Record<string, unknown>)[prop];
        },
      }),
    []
  );

  // Create overrides once with stable proxy options
  const overrides = useMemo(() => createCSSOverrides(stableOptions), [stableOptions]);

  return overrides;
}
