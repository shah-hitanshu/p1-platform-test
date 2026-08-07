import React from 'react';
import { Icon, IconButton } from '@pantheon-systems/pds-toolkit-react';
import { aiPanelStore } from '@pantheon-systems/puck-css';

export function ChatPanelHeader({
  canClear,
  onClear,
}: {
  canClear: boolean;
  onClear: () => void;
}): React.ReactElement {
  return (
    <div style={{
      padding: '12px 16px',
      // The same divider the editor header draws. PDS's `border-separator` is much darker.
      borderBottom: '1px solid var(--pds-color-border-default)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Avatar />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pds-color-foreground-default)' }}>
            Pantheon AI
          </div>
          {/* The design frame says "Design-system aware"; "blocks" is what the editor calls them. */}
          <div style={{ fontSize: 11, color: 'var(--pds-color-foreground-default-secondary)', marginTop: 2 }}>
            Builds and edits pages with your blocks
          </div>
        </div>
      </div>
      {/* Icons rather than labelled buttons, because a labelled Clear beside Close pushes the
          title onto a second line. Tooltips stay off for good: PDS places them with floating-ui,
          which misplaces them in this rail, so `ariaLabel` is what names these. */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        {canClear && (
          <IconButton
            ariaLabel="Clear conversation"
            iconName="trash"
            variant="critical"
            size="s"
            hasTooltip={false}
            onClick={onClear}
          />
        )}
        <IconButton
          ariaLabel="Close AI panel"
          iconName="xmark"
          size="s"
          hasTooltip={false}
          onClick={() => aiPanelStore.close()}
        />
      </div>
    </div>
  );
}

function Avatar(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: 28,
        height: 28,
        borderRadius: 6,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--pds-color-interactive-background-current-foreground)',
        background: 'var(--pds-color-interactive-background-current)',
      }}
    >
      <Icon iconName="sparkles" size="s" />
    </div>
  );
}
