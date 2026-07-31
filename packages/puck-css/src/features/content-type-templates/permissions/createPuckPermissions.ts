/**
 * Puck Permissions Resolver
 *
 * Creates a resolvePermissions function for Puck that enforces template constraints.
 */

import type { Template, TemplateSummary, ContentRole } from '../types.js';

/**
 * Puck permission flags for a component.
 */
export interface PuckPermissions {
  /** Can edit component props */
  edit: boolean;
  /** Can drag/reorder component */
  drag: boolean;
  /** Can delete component */
  delete: boolean;
  /** Can insert new components */
  insert: boolean;
  /** Can duplicate component */
  duplicate: boolean;
}

/**
 * Item passed to resolvePermissions by Puck.
 */
export interface PuckItem {
  type: string;
  props?: { id?: string; [key: string]: unknown };
}

/**
 * App state passed to resolvePermissions by Puck.
 */
export interface PuckAppState {
  // Placeholder for Puck's app state structure
  [key: string]: unknown;
}

/**
 * Permission resolver function type for Puck.
 */
export type PuckPermissionResolver = (
  item: PuckItem,
  appState: unknown
) => PuckPermissions;

/**
 * Create a Puck permissions resolver based on template and user role.
 *
 * A canvas component is pinned when its own `props.id` is a slot id that maps
 * to `true` in `root.props._pinMap` and has a matching component instance in
 * the template's content or zones. A same-typed component with a different id
 * (a local copy or duplicate) is never locked.
 *
 * Permission logic:
 * - **Pinned components**: drag=false, delete=false for all roles
 * - **Non-pinned components**:
 *   - Admin/Editor: full permissions
 *   - Junior Editor: no structural permissions (drag/delete/insert/duplicate)
 * - **Blank pages (no template)**:
 *   - Admin/Editor: full permissions
 *   - Junior Editor: no structural permissions
 * - **Historical versions**: all structural permissions false for all roles
 *
 * @param template - Template this document is bound to (null for blank pages;
 *   a metadata-only summary carries no pins)
 * @param role - User's content role
 * @param isHistoricalVersion - Whether viewing a historical version (read-only)
 * @returns Permission resolver function for Puck
 *
 * @example
 * ```tsx
 * const resolvePermissions = createPuckPermissions(template, 'editor', false);
 *
 * <Puck
 *   config={puckConfig}
 *   data={puckData}
 *   resolvePermissions={resolvePermissions}
 * />
 * ```
 */
export function createPuckPermissions(
  template: Template | TemplateSummary | null,
  role: ContentRole,
  isHistoricalVersion: boolean
): PuckPermissionResolver {
  const pinnedSlotIds = new Set<string>();
  if (template && 'content' in template) {
    const pinMap = template.root?.props?._pinMap ?? {};
    const instanceIds = new Set<string>();
    for (const item of template.content ?? []) {
      if (typeof item?.props?.id === 'string') {
        instanceIds.add(item.props.id);
      }
    }
    const zones = template.zones ?? {};
    for (const zoneItems of Object.values(zones)) {
      if (Array.isArray(zoneItems)) {
        for (const item of zoneItems) {
          const id = (item as { props?: { id?: unknown } })?.props?.id;
          if (typeof id === 'string') {
            instanceIds.add(id);
          }
        }
      }
    }
    for (const [id, pinned] of Object.entries(pinMap)) {
      if (pinned === true && instanceIds.has(id)) {
        pinnedSlotIds.add(id);
      }
    }
  }

  return (item: PuckItem): PuckPermissions => {
    // Historical versions: all structural permissions false
    if (isHistoricalVersion) {
      return {
        edit: true, // Can still view props in read-only mode
        drag: false,
        delete: false,
        insert: false,
        duplicate: false,
      };
    }

    const juniorEditorRestricted = role === 'junior-editor';

    // Pinned slot: locked for all roles when the item carries a pinned slot id
    const itemId = item.props?.id;
    if (typeof itemId === 'string' && pinnedSlotIds.has(itemId)) {
      return {
        edit: true,
        drag: false,
        delete: false,
        insert: !juniorEditorRestricted,
        duplicate: !juniorEditorRestricted,
      };
    }

    return {
      edit: true,
      drag: !juniorEditorRestricted,
      delete: !juniorEditorRestricted,
      insert: !juniorEditorRestricted,
      duplicate: !juniorEditorRestricted,
    };
  };
}
