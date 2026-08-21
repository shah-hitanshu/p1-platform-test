import type { PuckData } from '@pantheon-systems/css-client';

/**
 * Deep-copies a PuckData snapshot and prefixes every component id with
 * `prefix`. This prevents Puck from sharing id-keyed internal state between
 * panels rendered in the same React tree (e.g. source vs target in merge
 * comparison views). Components that share an id across branches via CoW
 * inheritance would otherwise have their props bleed from one panel to another.
 */
export function namespacePuckData(data: PuckData, prefix: string): PuckData {
  if (!data || !Array.isArray((data as { content?: unknown }).content)) {
    return data;
  }
  const nsItem = (item: { type: string; props: Record<string, unknown> }) => ({
    ...item,
    props: { ...item.props, id: `${prefix}${item.props.id as string}` },
  });
  const safeZones = data.zones && typeof data.zones === 'object' ? data.zones : {};
  return {
    ...data,
    content: data.content.map(nsItem),
    zones: Object.fromEntries(
      Object.entries(safeZones).map(([k, zone]) => [
        k,
        (Array.isArray(zone) ? zone : []).map(nsItem),
      ]),
    ),
  };
}
