/**
 * Phase 3: Presence UI Components Tests (TDD)
 *
 * Tests for CollaboratorAvatars, PresenceIndicator, AgentActivityBanner, FocusRegionHighlight.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import {
  CollaboratorAvatars,
  PresenceIndicator,
  AgentActivityBanner,
  FocusRegionHighlight,
} from '../src/collaboration/index.js';
import { PresenceContext } from '../src/core/PresenceContext.js';
import type { ActorPresence, CSSClient } from '@pantheon-systems/css-client';

// =============================================================================
// Mock Data
// =============================================================================

const mockHumanActor: ActorPresence = {
  id: 'presence-1',
  actorId: 'user-123',
  actorType: 'user',
  role: 'human',
  name: 'Alice Smith',
  avatar: 'https://example.com/alice.png',
  state: 'active',
  intent: undefined,
  focusRegions: ['/content/0'],
  lastActivityAt: '2026-01-27T10:00:00Z',
  joinedAt: '2026-01-27T09:00:00Z',
};

const mockHumanActor2: ActorPresence = {
  id: 'presence-2',
  actorId: 'user-456',
  actorType: 'user',
  role: 'human',
  name: 'Bob Jones',
  state: 'idle',
  focusRegions: [],
  lastActivityAt: '2026-01-27T09:30:00Z',
  joinedAt: '2026-01-27T09:00:00Z',
};

const mockAgentActor: ActorPresence = {
  id: 'presence-3',
  actorId: 'agent-789',
  actorType: 'agent',
  role: 'agent',
  name: 'Layout Optimizer',
  state: 'editing',
  intent: 'Optimizing layout for mobile',
  focusRegions: ['/content/1', '/content/2'],
  lastActivityAt: '2026-01-27T10:00:00Z',
  joinedAt: '2026-01-27T09:30:00Z',
};

const mockIdleAgent: ActorPresence = {
  id: 'presence-4',
  actorId: 'agent-abc',
  actorType: 'agent',
  role: 'agent',
  name: 'Content Assistant',
  state: 'idle',
  intent: undefined,
  focusRegions: [],
  lastActivityAt: '2026-01-27T09:00:00Z',
  joinedAt: '2026-01-27T08:00:00Z',
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(): CSSClient {
  return {
    presence: {
      getSitePresence: vi.fn().mockResolvedValue({}),
      getBranchPresence: vi.fn().mockResolvedValue({
        actors: [mockHumanActor, mockHumanActor2, mockAgentActor],
      }),
      getAgentPresence: vi.fn().mockResolvedValue({}),
    },
    agentEdit: {
      canEdit: vi.fn().mockResolvedValue({ allowed: true }),
      startEdit: vi.fn().mockResolvedValue({}),
      completeEdit: vi.fn().mockResolvedValue({}),
      abortEdit: vi.fn().mockResolvedValue({}),
    },
  } as unknown as CSSClient;
}

// =============================================================================
// Test Wrapper
// =============================================================================

interface TestWrapperProps {
  client?: CSSClient;
  children: React.ReactNode;
}

function TestWrapper({ client = createMockClient(), children }: TestWrapperProps) {
  return React.createElement(
    PresenceContext.Provider,
    {
      value: {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        documentPath: '/pages/home',
        userId: 'user-self',
      },
    },
    children
  );
}

// =============================================================================
// CollaboratorAvatars Tests
// =============================================================================

describe('CollaboratorAvatars', () => {
  describe('rendering', () => {
    it('should render avatars for all actors', () => {
      render(
        <CollaboratorAvatars actors={[mockHumanActor, mockAgentActor]} />,
        { wrapper: TestWrapper }
      );

      // Alice Smith has avatar image, Layout Optimizer has no image so shows initials
      expect(screen.getByRole('img', { name: 'Alice Smith' })).toBeInTheDocument();
      expect(screen.getByText('LO')).toBeInTheDocument(); // Layout Optimizer initials
    });

    it('should render avatar images when provided', () => {
      render(
        <CollaboratorAvatars actors={[mockHumanActor]} />,
        { wrapper: TestWrapper }
      );

      const img = screen.getByRole('img', { name: 'Alice Smith' });
      expect(img).toHaveAttribute('src', 'https://example.com/alice.png');
    });

    it('should show initials when no avatar image', () => {
      render(
        <CollaboratorAvatars actors={[mockHumanActor2]} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByText('BJ')).toBeInTheDocument(); // Bob Jones initials
    });

    it('should apply custom className', () => {
      const { container } = render(
        <CollaboratorAvatars actors={[mockHumanActor]} className="custom-class" />,
        { wrapper: TestWrapper }
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('maxVisible', () => {
    it('should limit visible avatars to maxVisible', () => {
      render(
        <CollaboratorAvatars
          actors={[mockHumanActor, mockHumanActor2, mockAgentActor]}
          maxVisible={2}
        />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByText('+1')).toBeInTheDocument();
    });

    it('should show all avatars when count <= maxVisible', () => {
      render(
        <CollaboratorAvatars
          actors={[mockHumanActor, mockHumanActor2]}
          maxVisible={3}
        />,
        { wrapper: TestWrapper }
      );

      expect(screen.queryByText(/\+\d/)).not.toBeInTheDocument();
    });
  });

  describe('agent separation', () => {
    it('should separate agents from humans when separateAgents is true', () => {
      const { container } = render(
        <CollaboratorAvatars
          actors={[mockHumanActor, mockAgentActor]}
          separateAgents={true}
        />,
        { wrapper: TestWrapper }
      );

      expect(container.querySelector('.css-puck-collaborator-avatars__separator')).toBeInTheDocument();
    });
  });

  describe('state indicators', () => {
    it('should show editing indicator for editing actors', () => {
      const { container } = render(
        <CollaboratorAvatars actors={[mockAgentActor]} />,
        { wrapper: TestWrapper }
      );

      expect(container.querySelector('.css-puck-collaborator-avatars__avatar--editing')).toBeInTheDocument();
    });

    it('should show agent badge for agent actors', () => {
      const { container } = render(
        <CollaboratorAvatars actors={[mockAgentActor]} />,
        { wrapper: TestWrapper }
      );

      expect(container.querySelector('.css-puck-collaborator-avatars__agent-badge')).toBeInTheDocument();
    });
  });

  describe('tooltips', () => {
    it('should show tooltip with actor name on hover', async () => {
      render(
        <CollaboratorAvatars actors={[mockHumanActor]} />,
        { wrapper: TestWrapper }
      );

      // Actor has avatar, so query by image alt
      const avatar = screen.getByRole('img', { name: 'Alice Smith' }).closest('[data-tooltip]');
      expect(avatar?.getAttribute('data-tooltip')).toContain('Alice Smith');
    });

    it('should show intent in tooltip for agents', () => {
      render(
        <CollaboratorAvatars actors={[mockAgentActor]} />,
        { wrapper: TestWrapper }
      );

      // Agent has no avatar, so initials are shown
      const avatar = screen.getByText('LO').closest('[data-tooltip]');
      expect(avatar?.getAttribute('data-tooltip')).toContain('Optimizing layout for mobile');
    });
  });

  describe('click handler', () => {
    it('should call onAvatarClick when avatar is clicked', () => {
      const handleClick = vi.fn();
      render(
        <CollaboratorAvatars
          actors={[mockHumanActor]}
          onAvatarClick={handleClick}
        />,
        { wrapper: TestWrapper }
      );

      // Actor has avatar, click the avatar container
      const avatarContainer = screen.getByRole('img', { name: 'Alice Smith' }).closest('[role="button"]');
      fireEvent.click(avatarContainer!);
      expect(handleClick).toHaveBeenCalledWith(mockHumanActor);
    });
  });

  describe('empty state', () => {
    it('should render nothing when no actors', () => {
      const { container } = render(
        <CollaboratorAvatars actors={[]} />,
        { wrapper: TestWrapper }
      );

      expect(container.firstChild).toBeEmptyDOMElement();
    });
  });
});

// =============================================================================
// PresenceIndicator Tests
// =============================================================================

describe('PresenceIndicator', () => {
  describe('rendering', () => {
    it('should show collaborator count', () => {
      render(
        <PresenceIndicator actors={[mockHumanActor, mockAgentActor]} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByText('2 collaborators')).toBeInTheDocument();
    });

    it('should show singular form for one collaborator', () => {
      render(
        <PresenceIndicator actors={[mockHumanActor]} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByText('1 collaborator')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <PresenceIndicator actors={[mockHumanActor]} className="custom-class" />,
        { wrapper: TestWrapper }
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('expandable panel', () => {
    it('should toggle panel on click when expandable', () => {
      render(
        <PresenceIndicator actors={[mockHumanActor]} expandable={true} />,
        { wrapper: TestWrapper }
      );

      const indicator = screen.getByText('1 collaborator');
      fireEvent.click(indicator);

      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    it('should not show panel when expandable is false', () => {
      render(
        <PresenceIndicator actors={[mockHumanActor]} expandable={false} />,
        { wrapper: TestWrapper }
      );

      const indicator = screen.getByText('1 collaborator');
      fireEvent.click(indicator);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should show state badges in expanded panel', () => {
      render(
        <PresenceIndicator actors={[mockHumanActor, mockAgentActor]} expandable={true} />,
        { wrapper: TestWrapper }
      );

      fireEvent.click(screen.getByText('2 collaborators'));

      expect(screen.getByText('active')).toBeInTheDocument();
      expect(screen.getByText('editing')).toBeInTheDocument();
    });

    it('should show focus regions in expanded panel', () => {
      render(
        <PresenceIndicator actors={[mockAgentActor]} expandable={true} />,
        { wrapper: TestWrapper }
      );

      fireEvent.click(screen.getByText('1 collaborator'));

      expect(screen.getByText('/content/1')).toBeInTheDocument();
      expect(screen.getByText('/content/2')).toBeInTheDocument();
    });
  });

  describe('panel position', () => {
    it('should apply top position class', () => {
      const { container } = render(
        <PresenceIndicator actors={[mockHumanActor]} expandable={true} panelPosition="top" />,
        { wrapper: TestWrapper }
      );

      fireEvent.click(screen.getByText('1 collaborator'));

      expect(container.querySelector('.css-puck-presence-indicator__panel--top')).toBeInTheDocument();
    });

    it('should apply bottom position class by default', () => {
      const { container } = render(
        <PresenceIndicator actors={[mockHumanActor]} expandable={true} />,
        { wrapper: TestWrapper }
      );

      fireEvent.click(screen.getByText('1 collaborator'));

      expect(container.querySelector('.css-puck-presence-indicator__panel--bottom')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should show "No collaborators" when empty', () => {
      render(
        <PresenceIndicator actors={[]} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByText('No collaborators')).toBeInTheDocument();
    });
  });
});

// =============================================================================
// AgentActivityBanner Tests
// =============================================================================

describe('AgentActivityBanner', () => {
  describe('rendering', () => {
    it('should show banner when agent is editing', () => {
      render(
        <AgentActivityBanner agent={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByText('Layout Optimizer')).toBeInTheDocument();
      expect(screen.getByText('Optimizing layout for mobile')).toBeInTheDocument();
    });

    it('should not show banner when agent is idle and showIdle is false', () => {
      const { container } = render(
        <AgentActivityBanner agent={mockIdleAgent} showIdle={false} />,
        { wrapper: TestWrapper }
      );

      expect(container.firstChild).toBeNull();
    });

    it('should show banner when agent is idle and showIdle is true', () => {
      render(
        <AgentActivityBanner agent={mockIdleAgent} showIdle={true} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByText('Content Assistant')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <AgentActivityBanner agent={mockAgentActor} className="custom-class" />,
        { wrapper: TestWrapper }
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('affected regions', () => {
    it('should display affected regions', () => {
      render(
        <AgentActivityBanner agent={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByText('/content/1')).toBeInTheDocument();
      expect(screen.getByText('/content/2')).toBeInTheDocument();
    });
  });

  describe('dismissible', () => {
    it('should show dismiss button when dismissible', () => {
      render(
        <AgentActivityBanner agent={mockAgentActor} dismissible={true} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('should hide banner when dismissed', () => {
      const { container } = render(
        <AgentActivityBanner agent={mockAgentActor} dismissible={true} />,
        { wrapper: TestWrapper }
      );

      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

      expect(container.firstChild).toBeNull();
    });

    it('should not show dismiss button when not dismissible', () => {
      render(
        <AgentActivityBanner agent={mockAgentActor} dismissible={false} />,
        { wrapper: TestWrapper }
      );

      expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });
  });

  describe('stop agent action', () => {
    it('should show stop agent button', () => {
      render(
        <AgentActivityBanner agent={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByRole('button', { name: /stop agent/i })).toBeInTheDocument();
    });

    it('should call onStopAgent when stop button is clicked', () => {
      const handleStop = vi.fn();
      render(
        <AgentActivityBanner agent={mockAgentActor} onStopAgent={handleStop} />,
        { wrapper: TestWrapper }
      );

      fireEvent.click(screen.getByRole('button', { name: /stop agent/i }));

      expect(handleStop).toHaveBeenCalledWith(mockAgentActor);
    });
  });

  describe('accessibility', () => {
    it('should have alert role', () => {
      render(
        <AgentActivityBanner agent={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});

// =============================================================================
// FocusRegionHighlight Tests
// =============================================================================

describe('FocusRegionHighlight', () => {
  describe('rendering', () => {
    it('should render highlight overlay for focus regions', () => {
      const { container } = render(
        <FocusRegionHighlight actor={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      expect(container.querySelector('.css-puck-focus-highlight')).toBeInTheDocument();
    });

    it('should not render when actor has no focus regions', () => {
      const { container } = render(
        <FocusRegionHighlight actor={mockHumanActor2} />,
        { wrapper: TestWrapper }
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('color assignment', () => {
    it('should use provided color', () => {
      const { container } = render(
        <FocusRegionHighlight actor={mockAgentActor} color="#ff0000" />,
        { wrapper: TestWrapper }
      );

      const highlight = container.querySelector('.css-puck-focus-highlight');
      expect(highlight).toHaveStyle({ '--highlight-color': '#ff0000' });
    });

    it('should auto-assign color based on actor ID when not provided', () => {
      const { container } = render(
        <FocusRegionHighlight actor={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      const highlight = container.querySelector('.css-puck-focus-highlight');
      // Verify a color is assigned (hsl format from generateColorFromId)
      const style = highlight?.getAttribute('style');
      expect(style).toContain('--highlight-color');
      expect(style).toMatch(/hsl\(\d+,\s*70%,\s*60%\)/);
    });
  });

  describe('editing animation', () => {
    it('should apply editing animation class when actor is editing', () => {
      const { container } = render(
        <FocusRegionHighlight actor={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      expect(container.querySelector('.css-puck-focus-highlight--editing')).toBeInTheDocument();
    });

    it('should not apply editing animation when actor is not editing', () => {
      const { container } = render(
        <FocusRegionHighlight actor={mockHumanActor} />,
        { wrapper: TestWrapper }
      );

      expect(container.querySelector('.css-puck-focus-highlight--editing')).not.toBeInTheDocument();
    });
  });

  describe('region data attributes', () => {
    it('should set data-region attribute for each focus region', () => {
      const { container } = render(
        <FocusRegionHighlight actor={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      expect(container.querySelector('[data-region="/content/1"]')).toBeInTheDocument();
      expect(container.querySelector('[data-region="/content/2"]')).toBeInTheDocument();
    });
  });

  describe('actor attribution', () => {
    it('should include actor name for accessibility', () => {
      render(
        <FocusRegionHighlight actor={mockAgentActor} />,
        { wrapper: TestWrapper }
      );

      expect(screen.getByLabelText(/Layout Optimizer/)).toBeInTheDocument();
    });
  });
});
