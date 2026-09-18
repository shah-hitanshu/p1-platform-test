import type { P1ExperimentalFeatureSet } from "./features";

/**
 * Which features are on is resolved once per context and then held for the life of the
 * page, so mounting a second gated component — or remounting the same one on every
 * document switch — costs nothing and cannot disagree with the first answer.
 *
 * In memory rather than in `sessionStorage`: a reload re-evaluates, which keeps a flag
 * change one refresh away instead of stranding someone behind a snapshot until they
 * open a new tab.
 */
const pending = new Map<string, Promise<P1ExperimentalFeatureSet>>();
const settled = new Map<string, P1ExperimentalFeatureSet>();

export function sessionKey(
  clientSideId: string,
  userId: string,
  siteId: string | undefined,
): string {
  return `${clientSideId}|${userId}|${siteId ?? ""}`;
}

/** The answer already resolved for this key, or null if none has been yet. */
export function peekFeatures(key: string): P1ExperimentalFeatureSet | null {
  return settled.get(key) ?? null;
}

export function featuresFor(
  key: string,
  resolve: () => Promise<P1ExperimentalFeatureSet>,
): Promise<P1ExperimentalFeatureSet> {
  const inFlight = pending.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = resolve().then((features) => {
    settled.set(key, features);
    return features;
  });

  pending.set(key, promise);
  return promise;
}

/** Test seam: drops every cached answer so a case can resolve its own. */
export function resetFeatureCache(): void {
  pending.clear();
  settled.clear();
}
