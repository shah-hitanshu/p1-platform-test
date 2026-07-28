import type { PuckData } from "@pantheon-systems/css-client";

const EMPTY: PuckData = { content: [], root: { props: {} } };

/**
 * Coerce a stored version snapshot into PuckData. Snapshots are typed as
 * objects, but the backend sometimes returns them as a JSON string; parsing
 * here keeps every downstream consumer (currentData, safeData, the Yjs seed,
 * the document-sync store) working with a real object instead of spreading a
 * string character-by-character. Empty or invalid snapshots — including the
 * blank initial version — collapse to blank Puck data.
 */
export function snapshotToPuckData(snapshot: unknown): PuckData {
  let value: unknown = snapshot;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return EMPTY;
    }
  }
  if (!value || typeof value !== "object") return EMPTY;
  const data = value as Partial<PuckData>;
  if (!data.content && !data.root) return EMPTY;
  return data as PuckData;
}
