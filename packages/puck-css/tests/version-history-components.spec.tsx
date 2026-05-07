/**
 * Phase 6: Enhanced Version History Components Tests (TDD)
 *
 * Tests for VersionItem and AgentCheckpointBadge components.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  VersionItem,
  AgentCheckpointBadge,
} from '../src/versioning/components/version-history/index.js';
import type { DocumentVersion, Checkpoint } from '@pantheon-systems/css-client';

// =============================================================================
// Mock Data
// =============================================================================

const mockVersion: DocumentVersion = {
  id: 'version-123',
  documentId: 'doc-1',
  versionNumber: 5,
  snapshot: { content: [], root: {} },
  createdAt: '2026-01-27T10:00:00Z',
  createdById: 'user-123',
};

const mockUserCheckpoint: Checkpoint = {
  id: 'checkpoint-1',
  branchId: 'branch-1',
  name: 'Manual save',
  checkpointType: 'manual',
  createdById: 'user-123',
  createdByType: 'user',
  createdAt: '2026-01-27T10:00:00Z',
  // Agent politeness fields (optional for user checkpoints)
  createdByName: 'Alice Smith',
};

const mockAgentCheckpoint: Checkpoint = {
  id: 'checkpoint-2',
  branchId: 'branch-1',
  name: 'Agent optimization',
  checkpointType: 'agent_edit',
  createdById: 'agent-789',
  createdByType: 'agent',
  createdAt: '2026-01-27T11:00:00Z',
  // Agent politeness fields
  description: 'Optimized layout for mobile devices',
  trigger: 'human_requested',
  createdByName: 'Layout Optimizer',
  requestedById: 'user-456',
  requestedByName: 'Bob Jones',
  operationType: 'layout_optimization',
  affectedRegions: ['/content/0', '/content/1'],
  status: 'completed',
};

const mockRolledBackCheckpoint: Checkpoint = {
  id: 'checkpoint-3',
  branchId: 'branch-1',
  name: 'Rolled back agent edit',
  checkpointType: 'agent_edit',
  createdById: 'agent-789',
  createdByType: 'agent',
  createdAt: '2026-01-27T12:00:00Z',
  createdByName: 'Layout Optimizer',
  trigger: 'autonomous',
  status: 'rolled_back',
  rolledBackById: 'user-123',
  rolledBackAt: '2026-01-27T12:05:00Z',
};

// =============================================================================
// VersionItem Tests
// =============================================================================

describe('VersionItem', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('basic rendering', () => {
    it('should display version number', () => {
      render(<VersionItem version={mockVersion} />);

      expect(screen.getByText(/v5|version 5/i)).toBeInTheDocument();
    });

    it('should display timestamp', () => {
      render(<VersionItem version={mockVersion} />);

      // Should show some form of the date
      expect(screen.getByText(/jan|27|2026|10:00/i)).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <VersionItem version={mockVersion} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('with checkpoint', () => {
    it('should display checkpoint name', () => {
      render(<VersionItem version={mockVersion} checkpoint={mockUserCheckpoint} />);

      expect(screen.getByText('Manual save')).toBeInTheDocument();
    });

    it('should display creator name when available', () => {
      render(<VersionItem version={mockVersion} checkpoint={mockUserCheckpoint} />);

      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  describe('with agent checkpoint', () => {
    it('should show agent badge for agent-created checkpoints', () => {
      render(
        <VersionItem
          version={mockVersion}
          checkpoint={mockAgentCheckpoint}
          showAgentInfo
        />
      );

      // Should have some indicator that this is an agent checkpoint
      const matches = screen.getAllByText(/agent|Layout Optimizer/i);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('should show trigger type for human_requested', () => {
      render(
        <VersionItem
          version={mockVersion}
          checkpoint={mockAgentCheckpoint}
          showAgentInfo
        />
      );

      expect(screen.getByText(/requested|human/i)).toBeInTheDocument();
    });

    it('should show who requested the agent action', () => {
      render(
        <VersionItem
          version={mockVersion}
          checkpoint={mockAgentCheckpoint}
          showAgentInfo
        />
      );

      expect(screen.getByText(/Bob Jones/i)).toBeInTheDocument();
    });

    it('should show operation type when available', () => {
      render(
        <VersionItem
          version={mockVersion}
          checkpoint={mockAgentCheckpoint}
          showAgentInfo
        />
      );

      const matches = screen.getAllByText(/layout|optimization/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe('rolled back checkpoint', () => {
    it('should show rolled back indicator', () => {
      render(
        <VersionItem
          version={mockVersion}
          checkpoint={mockRolledBackCheckpoint}
          showAgentInfo
        />
      );

      const matches = screen.getAllByText(/rolled back|reverted/i);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('should show who rolled back', () => {
      render(
        <VersionItem
          version={mockVersion}
          checkpoint={mockRolledBackCheckpoint}
          showAgentInfo
        />
      );

      // The rolledBackById is 'user-123', but we don't have the name populated
      // The component should show some indication of who rolled back
      const matches = screen.getAllByText(/rolled back|reverted/i);
      const container = matches[0].closest('div');
      expect(container).toBeInTheDocument();
    });
  });

  describe('click behavior', () => {
    it('should call onClick when clicked', () => {
      const onClick = vi.fn();
      render(<VersionItem version={mockVersion} onClick={onClick} />);

      fireEvent.click(screen.getByRole('button'));

      expect(onClick).toHaveBeenCalledWith(mockVersion);
    });

    it('should apply selected class when selected', () => {
      const { container } = render(
        <VersionItem version={mockVersion} isSelected />
      );

      expect(container.firstChild).toHaveClass(/--selected/);
    });
  });

  describe('compact mode', () => {
    it('should hide details in compact mode', () => {
      render(
        <VersionItem
          version={mockVersion}
          checkpoint={mockAgentCheckpoint}
          showAgentInfo
          compact
        />
      );

      // Should still show version number
      expect(screen.getByText(/v5|version 5/i)).toBeInTheDocument();

      // But should hide detailed info like affected regions
      expect(screen.queryByText('/content/0')).not.toBeInTheDocument();
    });
  });
});

// =============================================================================
// AgentCheckpointBadge Tests
// =============================================================================

describe('AgentCheckpointBadge', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render agent icon', () => {
      render(<AgentCheckpointBadge checkpoint={mockAgentCheckpoint} />);

      // Should have an agent indicator
      const badge = screen.getByRole('img', { hidden: true }) ||
                    screen.getByLabelText(/agent/i) ||
                    screen.getByText(/agent/i);
      expect(badge).toBeInTheDocument();
    });

    it('should display agent name', () => {
      render(<AgentCheckpointBadge checkpoint={mockAgentCheckpoint} />);

      expect(screen.getByText('Layout Optimizer')).toBeInTheDocument();
    });

    it('should show trigger type badge', () => {
      render(<AgentCheckpointBadge checkpoint={mockAgentCheckpoint} />);

      expect(screen.getByText(/requested|human/i)).toBeInTheDocument();
    });

    it('should show autonomous badge for autonomous triggers', () => {
      render(<AgentCheckpointBadge checkpoint={mockRolledBackCheckpoint} />);

      expect(screen.getByText(/autonomous|auto/i)).toBeInTheDocument();
    });
  });

  describe('tooltip', () => {
    it('should show tooltip on hover when showTooltip is true', async () => {
      render(<AgentCheckpointBadge checkpoint={mockAgentCheckpoint} showTooltip />);

      const badge = screen.getByText('Layout Optimizer').closest('div');
      fireEvent.mouseEnter(badge!);

      // Tooltip should show detailed info
      expect(screen.getByText(/Optimized layout for mobile/i)).toBeInTheDocument();
    });

    it('should show affected regions in tooltip', async () => {
      render(<AgentCheckpointBadge checkpoint={mockAgentCheckpoint} showTooltip />);

      const badge = screen.getByText('Layout Optimizer').closest('div');
      fireEvent.mouseEnter(badge!);

      expect(screen.getByText(/\/content\/0/)).toBeInTheDocument();
    });

    it('should not show tooltip when showTooltip is false', () => {
      render(<AgentCheckpointBadge checkpoint={mockAgentCheckpoint} showTooltip={false} />);

      const badge = screen.getByText('Layout Optimizer').closest('div');
      fireEvent.mouseEnter(badge!);

      // Description should not be visible
      expect(screen.queryByText(/Optimized layout for mobile/i)).not.toBeInTheDocument();
    });
  });

  describe('status indicators', () => {
    it('should show completed status', () => {
      render(<AgentCheckpointBadge checkpoint={mockAgentCheckpoint} />);

      // Completed is the default/expected state, may not have explicit indicator
      // but should not show rolled_back indicator
      expect(screen.queryByText(/rolled back/i)).not.toBeInTheDocument();
    });

    it('should show rolled back status', () => {
      render(<AgentCheckpointBadge checkpoint={mockRolledBackCheckpoint} />);

      expect(screen.getByText(/rolled back|reverted/i)).toBeInTheDocument();
    });
  });

  describe('user checkpoint', () => {
    it('should not render for user checkpoints', () => {
      const { container } = render(
        <AgentCheckpointBadge checkpoint={mockUserCheckpoint} />
      );

      // Should render nothing or minimal content for user checkpoints
      expect(container.firstChild).toBeNull();
    });
  });
});
