/**
 * Focus Region Map Utilities
 *
 * Utilities for mapping focus region paths to component IDs
 * and creating focus highlight information from actor presence data.
 */

import type { PuckData, PuckComponentData, ActorPresence } from '@pantheon-systems/css-client';
import { actorDisplayName } from './actorDisplayName.js';

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
  /** Whether the focus belongs to an AI agent rather than a person */
  isAgent?: boolean;
  /** Name of the person an agent is acting for, when it was asked to act */
  onBehalfOf?: string;
  /** The turn an agent is working on, when it named one. Distinguishes one run from the next */
  turnId?: string;
}

/** Agents share one color: they are one kind of activity, not identities. */
const AGENT_HIGHLIGHT_COLOR = '#000000';

/**
 * A pointer segment can itself contain a dot (`/content/0/props/meta.title`),
 * so the separator is chosen per path rather than both applied.
 */
function splitRegionPath(path: string): string[] {
  const body = path.startsWith('/') ? path.slice(1) : path;
  const separator = body.includes('/') ? '/' : '.';
  return body.split(separator).filter((segment) => segment.length > 0);
}

/** `root` carries props but no `type`, so requiring both keeps `/root` out. */
function isComponent(value: unknown): value is PuckComponentData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const node = value as { type?: unknown; props?: unknown };
  if (typeof node.type !== 'string') {
    return false;
  }
  const props = node.props as { id?: unknown } | undefined;
  return typeof props?.id === 'string' && props.id.length > 0;
}

/**
 * Convert a focus region path to a component ID.
 *
 * Accepts JSON-pointer (`/content/0`) and dot notation (`content.0`), and
 * resolves to the deepest component the path passes through: a prop path names
 * the component owning the prop, and a slot path the nested child. A path
 * naming no component (`content`) resolves to null.
 *
 * @param data - Puck data containing content and zones
 * @param path - Focus region path (e.g., "/content/0" or "content.0.props.title")
 * @returns Component ID if the path passes through one, null otherwise
 *
 * @example
 * ```typescript
 * pathToComponentId(puckData, '/content/0');            // first component in content
 * pathToComponentId(puckData, 'content.0.props.title'); // same component, via its prop
 * pathToComponentId(puckData, '/zones/Header:left/0');  // first component in a zone
 * ```
 */
export function pathToComponentId(data: PuckData, path: string): string | null {
  const segments = splitRegionPath(path);
  if (segments.length === 0) {
    return null;
  }

  // Puck's internal name for the content array, which the data has no key for.
  const normalized =
    segments[0] === 'root' && segments[1] === 'default-zone'
      ? ['content', ...segments.slice(2)]
      : segments;

  let node: unknown = data;
  let deepestId: string | null = null;

  for (const segment of normalized) {
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(segment)) {
        return deepestId;
      }
      node = node[Number(segment)];
    } else if (typeof node === 'object' && node !== null) {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return deepestId;
    }

    if (node === undefined || node === null) {
      return deepestId;
    }
    if (isComponent(node)) {
      deepestId = node.props.id;
    }
  }

  return deepestId;
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
 * const highlight = focusMap.get('hero-component-1');
 * const label =
 *   highlight === undefined ? 'nobody' : highlight.isEditing ? 'editing' : 'viewing';
 * ```
 */
export function createFocusRegionMap(
  data: PuckData,
  actors: ActorPresence[]
): Map<string, FocusHighlight> {
  const map = new Map<string, FocusHighlight>();

  for (const actor of actors) {
    const isAgent = actor.role === 'agent';
    const focusRegions = actor.focusRegions ?? [];

    for (const path of focusRegions) {
      const componentId = pathToComponentId(data, path);
      if (componentId === null) {
        // Skip invalid paths
        continue;
      }

      // An agent wins a block over a person: it is the one about to change it.
      if (!isAgent && map.get(componentId)?.isAgent === true) {
        continue;
      }

      map.set(componentId, {
        actorId: actor.actorId,
        actorName: actorDisplayName(actor),
        color: isAgent ? AGENT_HIGHLIGHT_COLOR : generateActorColor(actor.actorId),
        isEditing: actor.state === 'editing',
        isAgent,
        onBehalfOf: isAgent ? actor.requestedByName : undefined,
        turnId: isAgent ? actor.turnId : undefined,
      });
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
