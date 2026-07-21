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
  appState: PuckAppState
) => PuckPermissions;

/**
 * Create a Puck permissions resolver based on template and user role.
 *
 * A component type counts as pinned when the template's content has an
 * instance whose id maps to `true` in `root.props._pinMap`. Pages correlate
 * to the template by component type (durable per-instance ids are PCC-3358).
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
  const pinnedTypes = new Set<string>();
  if (template && 'content' in template) {
    const pinMap = template.root?.props?._pinMap ?? {};
    for (const item of template.content ?? []) {
      if (pinMap[item.props.id] === true) {
        pinnedTypes.add(item.type);
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

    // Pinned component: locked for all roles
    if (pinnedTypes.has(item.type)) {
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
