import React, { useCallback, useState } from 'react';
import { ActionBar, createUsePuck, usePuck } from '@puckeditor/core';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { useP1PuckOptional } from '../../../core/P1PuckContext.js';
import type { Template, TemplateComponent } from '../types.js';

const usePuckState = createUsePuck();

interface ContentItem {
  type: string;
  props: { id: string; [key: string]: unknown };
}

interface PinMapRecord {
  [componentId: string]: boolean;
}

function resolveTemplate(css: {
  currentTemplate: Template | null;
  currentDocument: { path: string } | null;
  templates: Template[];
}): Template | null {
  if (css.currentTemplate) return css.currentTemplate;

  const path = css.currentDocument?.path;
  if (!path) return null;

  const match = path.match(/^_registry\/templates\/(.+)$/);
  if (!match) return null;

  return css.templates.find((t) => t.name === match[1]) ?? null;
}

export function ActionBarPinButton(): React.ReactElement | null {
  const css = useP1PuckOptional();
  const selectedItem = usePuckState((s) => s.selectedItem) as ContentItem | null;
  const content = usePuckState(
    (s) => (s as unknown as { appState: { data: { content: ContentItem[] } } }).appState?.data?.content
  );
  const rootProps = usePuckState(
    (s) => (s as unknown as { appState: { data: { root: { props: Record<string, unknown> } } } }).appState?.data?.root?.props
  );

  const { dispatch, refreshPermissions } = usePuck();
  const [toggling, setToggling] = useState(false);

  const template = css ? resolveTemplate(css) : null;

  const pinMap: PinMapRecord = (rootProps?._pinMap as PinMapRecord) ?? {};

  const handleTogglePin = useCallback(async () => {
    if (!css || !template || !selectedItem || !content || toggling) return;
    setToggling(true);

    const compId = selectedItem.props.id;
    const newPinned = !pinMap[compId];

    const updatedPinMap = { ...pinMap, [compId]: newPinned };
    dispatch({
      type: 'setData',
      data: (prev: Record<string, unknown>) => ({
        ...prev,
        root: {
          ...(prev.root as Record<string, unknown>),
          props: {
            ...((prev.root as Record<string, unknown>).props as Record<string, unknown>),
            _pinMap: updatedPinMap,
          },
        },
      }),
    } as never);

    // Puck caches resolvePermissions results per component instance and only
    // re-resolves when the component's own data changes. Since _pinMap lives
    // in root props, toggling it doesn't invalidate per-component caches.
    // Force a full re-resolution so the updated pinMap is respected immediately.
    void refreshPermissions();

    const updatedComponents: TemplateComponent[] = content.map((c) => {
      const existing = template.components?.find((tc) => tc.type === c.type);
      return {
        type: c.type,
        pinned: updatedPinMap[c.props.id] ?? false,
        defaultProps: existing?.defaultProps ?? {},
      };
    });

    try {
      await css.client.templates.update(css.siteId, css.branchId, template.id, {
        components: updatedComponents,
      });
      await css.refreshTemplates();
    } finally {
      setToggling(false);
    }
  }, [css, template, selectedItem, content, pinMap, dispatch, refreshPermissions, toggling]);

  if (!css || !template || !selectedItem || !content) {
    return null;
  }

  const isAdmin = css.userRole === 'admin';
  const isPinned = pinMap[selectedItem.props.id] ?? false;

  return (
    <ActionBar.Action
      label={isPinned ? 'Unpin component' : 'Pin component'}
      onClick={handleTogglePin}
      active={isPinned}
      disabled={toggling || !isAdmin}
    >
      <Icon
        iconName={isPinned ? 'lock' : 'lockOpen'}
        iconSize="s"
        aria-hidden="true"
      />
    </ActionBar.Action>
  );
}
