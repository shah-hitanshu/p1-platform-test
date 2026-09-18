import type { VersionAttribution } from '../types/domain';

function isNamedRef(value: unknown): value is { id: string; name: string } {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.id === 'string' && ref.id.length > 0 && typeof ref.name === 'string';
}

export function isVersionAttribution(value: unknown): value is VersionAttribution {
  if (typeof value !== 'object' || value === null) return false;
  const attribution = value as Record<string, unknown>;
  return isNamedRef(attribution.agent)
    && isNamedRef(attribution.onBehalfOf)
    && typeof attribution.description === 'string';
}

/** Reads the attribution a version was stored with, if the metadata carries a well-formed one. */
export function attributionFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): VersionAttribution | undefined {
  const attribution = metadata?.attribution;
  return isVersionAttribution(attribution) ? attribution : undefined;
}
