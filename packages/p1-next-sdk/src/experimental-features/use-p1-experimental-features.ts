"use client";

import { useEffect, useMemo, useState } from "react";

import { resolveClientSideId } from "../launchdarkly/client-side-id";
import { ALL_OFF, type P1ExperimentalFeature, type P1ExperimentalFeatureSet } from "./features";
import { buildFeatureContext, resolveFeatures } from "./resolve-features";
import { featuresFor, peekFeatures, sessionKey } from "./session-cache";

export interface UseP1ExperimentalFeaturesOptions {
  /**
   * The signed-in person, as the key LaunchDarkly knows them by — the same one every
   * other P1 rollout check uses, so a person targeted in one place is targeted here
   * too. Absent — pre-auth, or signed out — means every feature off.
   */
  userId: string | null | undefined;
  /** The site being edited. Absent narrows evaluation to the user alone. */
  siteId?: string | null;
}

interface Answer {
  key: string | null;
  features: P1ExperimentalFeatureSet | null;
}

function peek(key: string | null): P1ExperimentalFeatureSet | null {
  return key ? peekFeatures(key) : null;
}

export interface P1ExperimentalFeatures {
  /**
   * Whether one experimental feature is available. False until LaunchDarkly has
   * answered, so a gated component never flashes into view and back out.
   */
  isEnabled: (feature: P1ExperimentalFeature) => boolean;
  /**
   * Whether LaunchDarkly has answered. Distinguishes "off" from "not yet known" for a
   * caller that wants to show a placeholder rather than nothing.
   */
  resolved: boolean;
}

/**
 * Which experimental features are turned on for this person, on this site.
 *
 * Availability is Pantheon's to decide, so a caller asks and wires the answer through
 * rather than configuring anything: an unset flag, an unreachable LaunchDarkly and a
 * signed-out reader all report off.
 *
 * Resolved once per user and site for the life of the page and shared between every
 * caller, so this can be called from as many components as need it. A flag changed
 * mid-session takes effect on the next load.
 */
export function useP1ExperimentalFeatures(
  options: UseP1ExperimentalFeaturesOptions,
): P1ExperimentalFeatures {
  const { userId, siteId } = options;
  const clientSideId = resolveClientSideId();

  // No client-side ID is the deliberate opt-out, and no user is nobody to evaluate for.
  const key =
    clientSideId && userId
      ? sessionKey(clientSideId, userId, siteId ?? undefined)
      : null;

  // The answer is held with the key it answers for, so a render after the user or site
  // changes never shows the previous context's features while the effect catches up.
  const [answer, setAnswer] = useState<Answer>(() => ({ key, features: peek(key) }));
  const features = answer.key === key ? answer.features : peek(key);

  useEffect(() => {
    if (!key || !userId) {
      return;
    }

    const cached = peekFeatures(key);
    if (cached) {
      setAnswer({ key, features: cached });
      return;
    }

    let active = true;
    void featuresFor(key, () =>
      resolveFeatures(clientSideId, buildFeatureContext(userId, siteId ?? undefined)),
    ).then((resolved) => {
      if (active) {
        setAnswer({ key, features: resolved });
      }
    });

    return () => {
      active = false;
    };
  }, [key, clientSideId, userId, siteId]);

  return useMemo(
    () => ({
      isEnabled: (feature: P1ExperimentalFeature) => (features ?? ALL_OFF)[feature],
      resolved: features !== null,
    }),
    [features],
  );
}
