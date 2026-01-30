/**
 * Focus Region Map Utilities
 *
 * Utilities for mapping focus region paths to component IDs
 * and creating focus highlight information from actor presence data.
 */

import type { PuckData, ActorPresence } from '@pantheon/css-client';

/**
 * Information about a focus highlight for a component.
 */
export interface FocusHighlight {
  /** Actor ID who has focus on this component */
  actorId: string;
  /** Actor display name */
  actorName: string;
  /** Color to use for highlighting (hex format) */
  color: string;
  /** Whether the actor is actively editing (vs just viewing) */
  isEditing: boolean;
}

/**
 * Convert a focus region path to a component ID.
 *
 * Supported path formats:
 * - "/content/N" - Content array at index N
 * - "/zones/ZoneName/N" - Zone array at index N
 *
 * @param data - Puck data containing content and zones
 * @param path - Focus region path (e.g., "/content/0" or "/zones/Header:left/1")
 * @returns Component ID if found, null otherwise
 *
 * @example
 * ```typescript
 * const id = pathToComponentId(puckData, '/content/0');
 * // Returns the ID of the first component in content array
 *
 * const zoneId = pathToComponentId(puckData, '/zones/Header:left/0');
 * // Returns the ID of the first component in Header:left zone
 * ```
 */
export function pathToComponentId(data: PuckData, path: string): string | null {
  if (!path || path.length === 0) {
    return null;
  }

  // Parse content paths: /content/N
  const contentMatch = path.match(/^\/content\/(\d+)$/);
  if (contentMatch && contentMatch[1] !== undefined) {
    const index = parseInt(contentMatch[1], 10);
    const component = data.content[index];
    return component?.props?.id ?? null;
  }

  // Parse Puck's root zone path: /root/default-zone/N
  // Puck uses "root:default-zone" internally for the main content area
  const rootZoneMatch = path.match(/^\/root\/default-zone\/(\d+)$/);
  if (rootZoneMatch && rootZoneMatch[1] !== undefined) {
    const index = parseInt(rootZoneMatch[1], 10);
    const component = data.content[index];
    return component?.props?.id ?? null;
  }

  // Parse zone paths: /zones/ZoneName/N
  // Zone names can contain colons (e.g., "Header:left")
  const zoneMatch = path.match(/^\/zones\/(.+)\/(\d+)$/);
  if (zoneMatch && zoneMatch[1] !== undefined && zoneMatch[2] !== undefined) {
    const zoneName = zoneMatch[1];
    const index = parseInt(zoneMatch[2], 10);

    if (!data.zones) {
      return null;
    }

    const zone = data.zones[zoneName];
    if (!zone) {
      return null;
    }

    const component = zone[index];
    return component?.props?.id ?? null;
  }

  // Unknown path format
  return null;
}

/**
 * Create a map of component IDs to focus highlight information.
 *
 * Processes actor presence data to determine which components are being
 * focused on by which actors, including their display info and state.
 *
 * @param data - Puck data containing content and zones
 * @param actors - Array of actor presence information
 * @returns Map from component ID to focus highlight info
 *
 * @example
 * ```typescript
 * const focusMap = createFocusRegionMap(puckData, otherActors);
 *
 * // Check if a component is focused
 * const highlight = focusMap.get('hero-component-1');
 * if (highlight) {
 *   console.log(`${highlight.actorName} is ${highlight.isEditing ? 'editing' : 'viewing'}`);
 * }
 * ```
 */
export function createFocusRegionMap(
  data: PuckData,
  actors: ActorPresence[]
): Map<string, FocusHighlight> {
  const map = new Map<string, FocusHighlight>();

  for (const actor of actors) {
    const focusRegions = actor.focusRegions ?? [];

    for (const path of focusRegions) {
      const componentId = pathToComponentId(data, path);
      if (componentId === null) {
        // Skip invalid paths
        continue;
      }

      // Create highlight info for this component
      const highlight: FocusHighlight = {
        actorId: actor.actorId,
        actorName: actor.name,
        color: generateActorColor(actor.actorId),
        isEditing: actor.state === 'editing',
      };

      map.set(componentId, highlight);
    }
  }

  return map;
}

/**
 * Generate a consistent color from an actor ID.
 *
 * Uses the djb2 hash algorithm to generate a hex color that:
 * - Is deterministic (same ID always produces same color)
 * - Matches the avatar color algorithm in CollaboratorAvatars.tsx
 * - Has consistent saturation (65%) and lightness (45%) for readability
 *
 * @param actorId - Actor identifier
 * @returns Hex color string (e.g., "#6366f1")
 *
 * @example
 * ```typescript
 * const color = generateActorColor('user-alice');
 * // Returns a consistent hex color for this actor
 * ```
 */
export function generateActorColor(actorId: string): string {
  // djb2 hash algorithm - must match CollaboratorAvatars.tsx for consistent colors
  let hash = 5381;
  for (let i = 0; i < actorId.length; i++) {
    hash = (hash * 33) ^ actorId.charCodeAt(i);
  }
  hash = hash >>> 0; // Convert to unsigned 32-bit integer

  // Use hash to generate HSL color with fixed saturation/lightness
  // Must match CollaboratorAvatars.tsx: hsl(hue, 65%, 45%)
  const hue = hash % 360;
  const saturation = 65;
  const lightness = 45;

  // Convert HSL to hex
  return hslToHex(hue, saturation, lightness);
}

/**
 * Convert HSL color to hex string.
 */
function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = lNorm - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number): string => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
