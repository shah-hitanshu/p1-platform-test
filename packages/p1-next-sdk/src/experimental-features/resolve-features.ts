import { initialize, type LDClient, type LDContext } from "launchdarkly-js-client-sdk";

import { ALL_OFF, readFeatures, type P1ExperimentalFeatureSet } from "./features";
import { localFlagOverrides, overridesEveryFeature } from "./local-overrides";

/**
 * How long to wait for LaunchDarkly before serving every feature off. Short on purpose:
 * this runs while the editor is loading, and an experimental feature that appears a
 * moment late is better than an editor that waits on a third party to open.
 */
const INITIALIZATION_TIMEOUT_SECONDS = 5;

/** The LaunchDarkly evaluation context: who is editing, and which site they are in. */
export function buildFeatureContext(
  userId: string,
  siteId: string | undefined,
): LDContext {
  if (!siteId) {
    return { kind: "user", key: userId };
  }

  // A multi-context so a feature can ramp per person, per site, or per both without a
  // code change — targeting either kind is then a LaunchDarkly-side decision.
  return {
    kind: "multi",
    user: { key: userId },
    site: { key: siteId },
  };
}

/**
 * Evaluate every experimental feature once for one context.
 *
 * Streaming is off and the client is closed as soon as it has answered: the result is a
 * snapshot, not a subscription. A feature turned on mid-session reaches the editor on
 * its next load, which is the trade this makes for holding no connection open and
 * re-evaluating nothing.
 */
export async function resolveFeatures(
  clientSideId: string,
  context: LDContext,
): Promise<P1ExperimentalFeatureSet> {
  // A local override is the answer, so it wins over LaunchDarkly rather than seeding it
  // — the same order a worker resolves in. One that answers for everything means there
  // is nothing left to ask, so local development neither needs a reachable
  // LaunchDarkly nor waits out the timeout for a flag that does not exist yet.
  const overrides = localFlagOverrides();
  if (overridesEveryFeature(overrides)) {
    return { ...ALL_OFF, ...overrides };
  }

  // Nothing here may throw: the caller caches this promise for the page's lifetime, and
  // a rejection would leave every later caller waiting on an answer that never comes.
  let client: LDClient | undefined;
  try {
    client = initialize(clientSideId, context, {
      streaming: false,
      diagnosticOptOut: true,
    });
    await client.waitForInitialization(INITIALIZATION_TIMEOUT_SECONDS);
    return { ...readFeatures(client.allFlags()), ...overrides };
  } catch {
    // An unreachable or misconfigured LaunchDarkly means we do not know, and "we do not
    // know" has to mean off for a feature that is not finished.
    return { ...ALL_OFF, ...overrides };
  } finally {
    void client?.close();
  }
}
