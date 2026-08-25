/**
 * P1InspectorFields
 *
 * Orchestrates the right inspector panel's fields override:
 *   - Page / Blocks tab header (tab mirrors Puck's itemSelector state)
 *   - Read-only banner + interaction guard when viewing a historical version
 *   - Delegates to P1TemplateFields when editing a template document
 *
 * Reads P1 context via useP1PuckOptional() and Puck state via createUsePuck().
 * Placed in the `fields` override so it always runs inside Puck's component tree.
 */

import React from 'react';
import { createUsePuck } from '@puckeditor/core';
import { IconButton } from '@pantheon-systems/pds-toolkit-react';
import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { useSidebarScrollPreservation } from '../useSidebarScrollPreservation.js';
import { templateFromRegistryPath } from '../utils/templatePath.js';
import { ReadOnlyFieldsGuard } from '../../versioning/components/ReadOnlyFieldsGuard.js';
import { VersionReadOnlyBanner } from '../../versioning/components/VersionReadOnlyBanner.js';
import { DataListFieldsGrouper } from '../../data/data-list-block/DataListFieldsGrouper.js';
import { P1TemplateFields } from './P1TemplateFields.js';
import { InspectorTabHeader } from './InspectorTabHeader.js';

// Selectors are at module level so the hook identity is stable across renders.
const useInspectorPuck = createUsePuck();
const useInspectorSelectedType = createUsePuck();
const useInspectorContentLength = createUsePuck();
const useInspectorRightVisible = createUsePuck();
const useInspectorDispatch = createUsePuck();
const useInspectorConfig = createUsePuck();

export function P1InspectorFields({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const ccr = useP1PuckOptional();

  const itemSelector = useInspectorPuck(
    (s) =>
      (s as unknown as { appState?: { ui?: { itemSelector?: unknown } } }).appState?.ui
        ?.itemSelector ?? null,
  );

  useSidebarScrollPreservation(itemSelector);
  const selectedBlockType = useInspectorSelectedType(
    (s) => (s as unknown as { selectedItem?: { type?: string } | null }).selectedItem?.type ?? null,
  );
  const contentLength = useInspectorContentLength(
    (s) =>
      (s as unknown as { appState?: { data?: { content?: unknown[] } } }).appState?.data?.content
        ?.length ?? 0,
  );
  const rightSideBarVisible = useInspectorRightVisible(
    (s) =>
      (s as unknown as { appState?: { ui?: { rightSideBarVisible?: boolean } } }).appState?.ui
        ?.rightSideBarVisible ?? true,
  );

  const dispatch = useInspectorDispatch((s) => s.dispatch) as (action: unknown) => void;
  const config = useInspectorConfig((s) => s.config);

  const selectedBlockLabel = selectedBlockType
    ? ((config.components as Record<string, { label?: string }>)[selectedBlockType]?.label ?? selectedBlockType)
    : null;

  const isReadOnly = ccr?.isViewingHistoricalVersion ?? false;
  const versionNumber = ccr?.viewingVersion?.versionNumber ?? null;
  const activeTab: 'page' | 'block' = itemSelector ? 'block' : 'page';

  const handleTabChange = (tab: 'page' | 'block') => {
    if (tab === 'page' && itemSelector) {
      dispatch({ type: 'setUi', ui: { itemSelector: null } } as never);
    }
    if (tab === 'block' && !itemSelector && contentLength > 0) {
      // Puck indexes the root zone as `rootDroppableId` (`root:default-zone`);
      // the bare zone name resolves to no zone, so getItem() selects nothing.
      dispatch({
        type: 'setUi',
        ui: { itemSelector: { zone: 'root:default-zone', index: 0 } },
      } as never);
    }
  };

  const handleCollapse = () => {
    dispatch({ type: 'setUi', ui: { rightSideBarVisible: false } } as never);
  };

  const handleReopen = () => {
    dispatch({ type: 'setUi', ui: { rightSideBarVisible: true } } as never);
  };

  if (!rightSideBarVisible) {
    return (
      <div className="p1-inspector-reopen-strip">
        <IconButton
          ariaLabel="Open inspector panel"
          iconName="tableRows"
          size="s"
          hasTooltip={false}
          hasBorder={false}
          onClick={handleReopen}
          className="p1-inspector-reopen-btn"
        />
      </div>
    );
  }

  const template = templateFromRegistryPath(ccr?.currentDocument?.path, ccr?.templates);
  if (template && !itemSelector && ccr?.updateTemplate) {
    // Guarded like the main return — without this, template fields stay editable
    // while viewing a read-only historical version.
    return (
      <ReadOnlyFieldsGuard isReadOnly={isReadOnly}>
        <P1TemplateFields>{children}</P1TemplateFields>
      </ReadOnlyFieldsGuard>
    );
  }

  const templateLabel = !itemSelector
    ? (ccr?.currentTemplate as { root?: { props?: { _template?: { label?: string } } } } | null)
        ?.root?.props?._template?.label
      ?? (ccr?.templates as { id: string; label: string }[] | undefined)?.find(
           (t) => t.id === (ccr?.currentDocument as { templateId?: string } | undefined)?.templateId,
         )?.label
      ?? null
    : null;

  return (
    <div className={`p1-inspector-fields${isReadOnly ? ' p1-inspector-fields--readonly' : ''}`}>
      <InspectorTabHeader
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isReadOnly={isReadOnly}
        rightSideBarVisible={rightSideBarVisible}
        onCollapse={handleCollapse}
      />
      {isReadOnly && versionNumber !== null && (
        <VersionReadOnlyBanner versionNumber={versionNumber} />
      )}
      {activeTab === 'block' && selectedBlockLabel && (
        <div className="p1-inspector-breadcrumb" aria-label="Selected block location">
          <span className="p1-inspector-breadcrumb__sep" aria-hidden="true">Page</span>
          <span className="p1-inspector-breadcrumb__sep" aria-hidden="true">›</span>
          <span className="p1-inspector-breadcrumb__block">{selectedBlockLabel}</span>
        </div>
      )}
      <ReadOnlyFieldsGuard isReadOnly={isReadOnly}>
        {selectedBlockType &&
         (config.components as Record<string, { _fieldGroups?: Record<string, string> }>)[selectedBlockType]?._fieldGroups
          ? <DataListFieldsGrouper>{children}</DataListFieldsGrouper>
          : children}
        {templateLabel && (
          <div className="p1-inspector-template-badge">
            <span className="p1-inspector-template-badge__label">Template</span>
            <span className="p1-inspector-template-badge__name">{templateLabel}</span>
          </div>
        )}
      </ReadOnlyFieldsGuard>
    </div>
  );
}
