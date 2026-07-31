/**
 * Phase 8: Plugin Integration Tests (TDD)
 *
 * Tests for enhanced createP1Plugin and createP1Overrides with
 * presence and agent features.
 *
 * These tests verify that the new options are accepted by the plugin
 * and overrides functions. Rendering tests are intentionally minimal
 * to avoid memory issues with the test runner.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createP1Plugin, createP1Overrides } from '../src/editor/plugin/index.js';
import type { Branch, RegisteredAgent, ActorPresence } from '@pantheon-systems/css-client';

// =============================================================================
// Mock Data
// =============================================================================

const mockBranch: Branch = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const mockAgent: RegisteredAgent = {
  id: 'agent-1',
  organizationId: 'org-1',
  name: 'Layout Optimizer',
  description: 'Optimizes page layouts',
  capabilities: ['layout', 'optimization'],
  status: 'active',
  settings: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockHumanPresence: ActorPresence = {
  id: 'presence-1',
  actorId: 'user-1',
  actorType: 'user',
  role: 'human',
  name: 'Alice Smith',
  state: 'active',
  lastActivityAt: '2026-01-27T10:00:00Z',
  joinedAt: '2026-01-27T09:00:00Z',
};

const mockAgentPresence: ActorPresence = {
  id: 'presence-3',
  actorId: 'agent-1',
  actorType: 'agent',
  role: 'agent',
  name: 'Layout Optimizer',
  state: 'editing',
  intent: 'Optimizing hero section layout',
  focusRegions: ['/content/0'],
  lastActivityAt: '2026-01-27T10:00:00Z',
  joinedAt: '2026-01-27T09:58:00Z',
};

// =============================================================================
// createP1Plugin Tests - Presence/Agent Features
// =============================================================================

describe('createP1Plugin with presence/agent features', () => {
  it('should accept showPresenceIndicator and presence options', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showPresenceIndicator: true,
      presence: [mockHumanPresence],
    });
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('css');
  });

  it('should accept showAgentActivity and activeAgents options', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showAgentActivity: true,
      activeAgents: [mockAgentPresence],
    });
    expect(plugin).toBeDefined();
  });

  it('should accept showAgentActions and availableAgents options', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showAgentActions: true,
      availableAgents: [mockAgent],
      onAgentAction: vi.fn(),
    });
    expect(plugin).toBeDefined();
  });

  it('should accept showFocusRegions and agentEditingRegions options', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showFocusRegions: true,
      agentEditingRegions: ['/content/0'],
    });
    expect(plugin).toBeDefined();
  });

  it('should render presence section when showPresenceIndicator is true', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showPresenceIndicator: true,
      presence: [mockHumanPresence],
    });
    render(<>{plugin.render()}</>);
    expect(screen.getByText(/collaborators|presence/i)).toBeInTheDocument();
  });

  it('should show collaborator names in presence section', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showPresenceIndicator: true,
      presence: [mockHumanPresence],
    });
    render(<>{plugin.render()}</>);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('should render agent activity section with agent name', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showAgentActivity: true,
      activeAgents: [mockAgentPresence],
    });
    render(<>{plugin.render()}</>);
    expect(screen.getByText(/agent activity|agents/i)).toBeInTheDocument();
    expect(screen.getByText('Layout Optimizer')).toBeInTheDocument();
  });

  it('should render agent actions button when enabled', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showAgentActions: true,
      availableAgents: [mockAgent],
    });
    render(<>{plugin.render()}</>);
    expect(screen.getByRole('button', { name: /trigger agent|ask agent/i })).toBeInTheDocument();
  });

  it('should show focus regions when agent is editing', () => {
    // @ts-expect-error - Testing new options not yet in types
    const plugin = createP1Plugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      showAgentActivity: true,
      showFocusRegions: true,
      activeAgents: [mockAgentPresence],
      agentEditingRegions: ['/content/0'],
    });
    render(<>{plugin.render()}</>);
    expect(screen.getByText('/content/0')).toBeInTheDocument();
  });
});

// =============================================================================
// createP1Overrides Tests - Presence/Agent Features
// =============================================================================

describe('createP1Overrides with presence/agent features', () => {
  const baseOptions = {
    getSaveStatus: () => 'saved' as const,
    getLastSaved: () => new Date(),
    getSaveError: () => null,
    onRetrySave: vi.fn(),
    onPublish: vi.fn().mockResolvedValue({ id: 'cp-1', name: 'Test' }),
  };

  it('should accept showCollaboratorAvatars and presence options', () => {
    // @ts-expect-error - Testing new options not yet in types
    const overrides = createP1Overrides({
      ...baseOptions,
      showCollaboratorAvatars: true,
      presence: [mockHumanPresence],
    });
    expect(overrides).toBeDefined();
    expect(overrides.headerActions).toBeDefined();
  });

  it('should accept showAgentActivityBanner and activeAgents options', () => {
    // @ts-expect-error - Testing new options not yet in types
    const overrides = createP1Overrides({
      ...baseOptions,
      showAgentActivityBanner: true,
      activeAgents: [mockAgentPresence],
      isAgentEditing: true,
    });
    expect(overrides).toBeDefined();
  });

  it('should accept onStopAgent callback option', () => {
    const handleStopAgent = vi.fn();
    const overrides = createP1Overrides({
      ...baseOptions,
      showAgentActivityBanner: true,
      activeAgents: [mockAgentPresence],
      isAgentEditing: true,
      onStopAgent: handleStopAgent,
    });
    expect(overrides).toBeDefined();
    expect(overrides.headerActions).toBeDefined();
  });
});
