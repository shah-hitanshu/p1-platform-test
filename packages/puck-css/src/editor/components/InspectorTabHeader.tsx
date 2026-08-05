/**
 * InspectorTabHeader
 *
 * Page / Blocks tab switcher shown at the top of the right inspector panel.
 * The active tab mirrors Puck's itemSelector state (block selected = Blocks tab).
 * Tabs remain interactive even in read-only version preview mode — the read-only
 * guard is on the fields below, not the tab switcher.
 */

import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

export interface InspectorTabHeaderProps {
  activeTab: 'page' | 'block';
  onTabChange: (tab: 'page' | 'block') => void;
  isReadOnly: boolean;
  rightSideBarVisible?: boolean;
  onCollapse?: () => void;
}

const TABS: { id: 'page' | 'block'; label: string }[] = [
  { id: 'page', label: 'Page' },
  { id: 'block', label: 'Blocks' },
];

export function InspectorTabHeader({
  activeTab,
  onTabChange,
  rightSideBarVisible = true,
  onCollapse,
}: InspectorTabHeaderProps): React.ReactElement {
  return (
    <div className="p1-inspector-tab-header" role="tablist">
      {TABS.map(({ id, label }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            className="p1-inspector-tab"
            onClick={() => {
              if (!isActive) onTabChange(id);
            }}
            type="button"
          >
            {label}
          </button>
        );
      })}
      {onCollapse && (
        <button
          type="button"
          className="p1-inspector-tab-collapse"
          onClick={onCollapse}
          aria-label="Collapse panel"
          aria-pressed={rightSideBarVisible}
          title="Collapse panel"
        >
          <Icon iconName="angleRight" size="s" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
