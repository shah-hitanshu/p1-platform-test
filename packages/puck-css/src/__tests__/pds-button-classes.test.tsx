/**
 * Tests for PDS button class application across components.
 *
 * Validates that all button components use PDS button CSS classes
 * instead of ad-hoc inline styles or custom CSS classes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

afterEach(() => {
  cleanup();
});

// ============================================================
// PublishButton Tests
// ============================================================

// Mock css-client for PublishButton
vi.mock('@pantheon/css-client', () => ({
  CSSClient: vi.fn(),
}));

import { PublishButton } from '../components/PublishButton.js';

describe('PublishButton PDS classes', () => {
  it('renders trigger button with pds-button classes', () => {
    render(
      <PublishButton onPublish={() => Promise.resolve({} as never)}>
        Publish
      </PublishButton>
    );
    const btn = screen.getByRole('button', { name: 'Publish' });
    expect(btn.className).toContain('pds-button');
    expect(btn.className).toContain('pds-button--primary');
    expect(btn.className).toContain('pds-button--sm');
  });

  it('renders confirm button with pds-button--primary classes', async () => {
    render(
      <PublishButton onPublish={() => Promise.resolve({} as never)}>
        Publish
      </PublishButton>
    );
    // Click to show confirm
    screen.getByRole('button', { name: 'Publish' }).click();
    const confirmBtn = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmBtn.className).toContain('pds-button');
    expect(confirmBtn.className).toContain('pds-button--primary');
    expect(confirmBtn.className).toContain('pds-button--sm');
    // Should not have inline background style
    expect(confirmBtn.style.background).toBeFalsy();
  });

  it('renders cancel button with pds-button--secondary classes', async () => {
    render(
      <PublishButton onPublish={() => Promise.resolve({} as never)}>
        Publish
      </PublishButton>
    );
    screen.getByRole('button', { name: 'Publish' }).click();
    const cancelBtn = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancelBtn.className).toContain('pds-button');
    expect(cancelBtn.className).toContain('pds-button--secondary');
    expect(cancelBtn.className).toContain('pds-button--sm');
    // Should not have inline border style
    expect(cancelBtn.style.border).toBeFalsy();
  });
});

// ============================================================
// SaveIndicator Tests
// ============================================================

import { SaveIndicator } from '../components/SaveIndicator.js';

describe('SaveIndicator PDS classes', () => {
  it('renders retry button with pds-button classes', () => {
    render(
      <SaveIndicator status="error" onRetry={() => {}} />
    );
    const retryBtn = screen.getByRole('button', { name: 'Retry save' });
    expect(retryBtn.className).toContain('pds-button');
    expect(retryBtn.className).toContain('pds-button--subtle');
    expect(retryBtn.className).toContain('pds-button--sm');
  });
});

// ============================================================
// HistoricalVersionBanner Tests
// ============================================================

import { HistoricalVersionBanner } from '../components/HistoricalVersionBanner.js';

describe('HistoricalVersionBanner PDS classes', () => {
  it('renders Return to current button with pds-button classes', () => {
    render(
      <HistoricalVersionBanner
        version={{
          id: 'v1',
          versionNumber: 1,
          createdAt: '2024-01-01T00:00:00Z',
          documentId: 'doc1',
          snapshotRef: 'ref1',
        }}
        onReturnToLatest={() => {}}
      />
    );
    const btn = screen.getByRole('button', { name: 'Return to current' });
    expect(btn.className).toContain('pds-button');
    expect(btn.className).toContain('pds-button--primary');
    expect(btn.className).toContain('pds-button--sm');
  });
});

// ============================================================
// ViewModeSelector Tests
// ============================================================

import { ViewModeSelector } from '../components/merge-preview/ViewModeSelector.js';

describe('ViewModeSelector PDS classes', () => {
  it('renders view mode buttons with pds-button classes', () => {
    render(
      <ViewModeSelector viewMode="side-by-side" onViewModeChange={() => {}} />
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn.className).toContain('pds-button');
      expect(btn.className).toContain('pds-button--secondary');
      expect(btn.className).toContain('pds-button--sm');
    });
  });

  it('applies pds-button--active class to active mode button', () => {
    render(
      <ViewModeSelector viewMode="overlay" onViewModeChange={() => {}} />
    );
    const overlayBtn = screen.getByRole('button', { name: 'Overlay' });
    expect(overlayBtn.className).toContain('pds-button--active');

    const sideBtn = screen.getByRole('button', { name: 'Side by side' });
    expect(sideBtn.className).not.toContain('pds-button--active');
  });
});

// ============================================================
// DiffHeader Tests
// ============================================================

import { DiffHeader } from '../components/version-compare/DiffHeader.js';

describe('DiffHeader PDS classes', () => {
  it('renders close button with pds-button classes', () => {
    render(
      <DiffHeader beforeVersion={1} afterVersion={2} onClose={() => {}} />
    );
    const closeBtn = screen.getByRole('button', { name: 'Close comparison' });
    expect(closeBtn.className).toContain('pds-button');
    expect(closeBtn.className).toContain('pds-button--subtle');
    expect(closeBtn.className).toContain('pds-button--sm');
  });
});

// ============================================================
// BranchDiffHeader Tests
// ============================================================

import { BranchDiffHeader } from '../components/version-compare/BranchDiffHeader.js';

describe('BranchDiffHeader PDS classes', () => {
  it('renders close button with pds-button classes', () => {
    render(
      <BranchDiffHeader
        sourceBranchName="feature"
        targetBranchName="main"
        onClose={() => {}}
      />
    );
    const closeBtn = screen.getByRole('button', { name: 'Close comparison' });
    expect(closeBtn.className).toContain('pds-button');
    expect(closeBtn.className).toContain('pds-button--subtle');
    expect(closeBtn.className).toContain('pds-button--sm');
  });
});

// ============================================================
// Toast Tests
// ============================================================

import { Toast } from '../components/Toast.js';

describe('Toast PDS classes', () => {
  it('renders action buttons with pds-button classes', () => {
    render(
      <Toast
        notification={{
          id: '1',
          message: 'Test',
          severity: 'info',
          createdAt: new Date(),
          actions: [{ label: 'Undo', onClick: () => {} }],
        }}
        onDismiss={() => {}}
      />
    );
    const actionBtn = screen.getByRole('button', { name: 'Undo' });
    expect(actionBtn.className).toContain('pds-button');
    expect(actionBtn.className).toContain('pds-button--subtle');
    expect(actionBtn.className).toContain('pds-button--sm');
  });

  it('renders dismiss button with pds-button classes', () => {
    render(
      <Toast
        notification={{
          id: '1',
          message: 'Test',
          severity: 'info',
          createdAt: new Date(),
        }}
        onDismiss={() => {}}
      />
    );
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(dismissBtn.className).toContain('pds-button');
    expect(dismissBtn.className).toContain('pds-button--subtle');
    expect(dismissBtn.className).toContain('pds-button--sm');
  });
});

// ============================================================
// AgentActivityBanner Tests
// ============================================================

import { AgentActivityBanner } from '../components/presence/AgentActivityBanner.js';

describe('AgentActivityBanner PDS classes', () => {
  const mockAgent = {
    id: 'a1',
    actorId: 'actor1',
    name: 'Test Agent',
    state: 'editing' as const,
    type: 'agent' as const,
    lastSeen: new Date().toISOString(),
  };

  it('renders stop button with pds-button--critical-secondary classes', () => {
    render(<AgentActivityBanner agent={mockAgent} />);
    const stopBtn = screen.getByRole('button', { name: 'Stop Agent' });
    expect(stopBtn.className).toContain('pds-button');
    expect(stopBtn.className).toContain('pds-button--critical-secondary');
    expect(stopBtn.className).toContain('pds-button--sm');
  });

  it('renders dismiss button with pds-button--subtle classes', () => {
    render(<AgentActivityBanner agent={mockAgent} dismissible />);
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismissBtn.className).toContain('pds-button');
    expect(dismissBtn.className).toContain('pds-button--subtle');
    expect(dismissBtn.className).toContain('pds-button--sm');
  });
});

// ============================================================
// ConflictNotificationToast Tests
// ============================================================

// Mock useConflictNotifications module
vi.mock('../components/conflict-notifications/useConflictNotifications', () => ({}));

import { ConflictNotificationToast } from '../components/conflict-notifications/ConflictNotificationToast.js';

describe('ConflictNotificationToast PDS classes', () => {
  it('renders action button with pds-button classes', () => {
    render(
      <ConflictNotificationToast
        notification={{
          id: '1',
          type: 'agent_editing',
          message: 'Agent is editing',
          timestamp: new Date(),
        }}
        onDismiss={() => {}}
        onAction={() => {}}
        actionLabel="View Changes"
      />
    );
    const actionBtn = screen.getByRole('button', { name: 'View Changes' });
    expect(actionBtn.className).toContain('pds-button');
    expect(actionBtn.className).toContain('pds-button--subtle');
    expect(actionBtn.className).toContain('pds-button--sm');
  });

  it('renders dismiss button with pds-button classes', () => {
    render(
      <ConflictNotificationToast
        notification={{
          id: '1',
          type: 'agent_editing',
          message: 'Agent is editing',
          timestamp: new Date(),
        }}
        onDismiss={() => {}}
      />
    );
    // ConflictNotificationToast dismiss uses aria-label="Dismiss notification"
    const dismissBtns = screen.getAllByRole('button');
    const dismissBtn = dismissBtns.find((btn) =>
      btn.getAttribute('aria-label') === 'Dismiss notification'
    );
    expect(dismissBtn).toBeTruthy();
    expect(dismissBtn!.className).toContain('pds-button');
    expect(dismissBtn!.className).toContain('pds-button--subtle');
    expect(dismissBtn!.className).toContain('pds-button--sm');
  });
});

// ============================================================
// CSSPlugin Tests
// ============================================================

// Mock required CSSPlugin dependencies
vi.mock('../components/PuckDataSynchronizer', () => ({
  PuckDataSynchronizer: () => null,
}));
vi.mock('../components/PuckSelectionTracker', () => ({
  PuckSelectionTracker: () => null,
}));
vi.mock('../CSSPuckContext', () => ({
  useCSSPuck: () => ({
    currentData: null,
    remoteSyncKey: null,
    currentDocument: null,
    viewingVersion: null,
  }),
}));

import { createCSSPlugin } from '../plugin/CSSPlugin.js';

describe('CSSPlugin PDS button classes', () => {
  it('renders Compare with main button with pds-button classes', () => {
    const plugin = createCSSPlugin({
      branches: [
        { id: '1', name: 'feature', isMain: false, siteId: 's1', createdAt: '' },
        { id: '2', name: 'main', isMain: true, siteId: 's1', createdAt: '' },
      ],
      currentBranch: { id: '1', name: 'feature', isMain: false, siteId: 's1', createdAt: '' },
      onBranchSwitch: () => {},
      onMergeCompare: () => {},
    });
    render(plugin.render());
    const compareBtn = screen.getByRole('button', { name: 'Compare with Live' });
    expect(compareBtn.className).toContain('pds-button');
    expect(compareBtn.className).toContain('pds-button--secondary');
  });

  it('renders Ask Agent button with pds-button--primary classes', () => {
    const plugin = createCSSPlugin({
      branches: [],
      currentBranch: null,
      onBranchSwitch: () => {},
      showAgentActions: true,
      availableAgents: [{ id: 'a1', name: 'Agent', capabilities: [], siteId: 's1' }],
      onAgentAction: () => {},
    });
    render(plugin.render());
    const agentBtn = screen.getByRole('button', { name: 'Ask Agent' });
    expect(agentBtn.className).toContain('pds-button');
    expect(agentBtn.className).toContain('pds-button--primary');
  });

  it('renders Create document button with pds-button classes', () => {
    const plugin = createCSSPlugin({
      branches: [],
      currentBranch: null,
      onBranchSwitch: () => {},
      onDocumentSelect: () => {},
      onDocumentCreate: async () => {},
    });
    render(plugin.render());
    // Click the + button to open create form
    const addBtn = screen.getByRole('button', { name: '+' });
    expect(addBtn.className).toContain('pds-button');
    expect(addBtn.className).toContain('pds-button--subtle');
    expect(addBtn.className).toContain('pds-button--sm');
  });
});

// ============================================================
// AgentStatusPanel Tests
// ============================================================

import { AgentStatusPanel } from '../components/agent-actions/AgentStatusPanel.js';

describe('AgentStatusPanel PDS classes', () => {
  it('renders cancel button with pds-button--subtle classes', () => {
    render(
      <AgentStatusPanel
        agent={{ id: 'a1', name: 'Agent', capabilities: [], siteId: 's1' }}
        status="editing"
        onCancel={() => {}}
      />
    );
    const cancelBtn = screen.getByRole('button', { name: 'Cancel action' });
    expect(cancelBtn.className).toContain('pds-button');
    expect(cancelBtn.className).toContain('pds-button--subtle');
    expect(cancelBtn.className).toContain('pds-button--sm');
  });
});
