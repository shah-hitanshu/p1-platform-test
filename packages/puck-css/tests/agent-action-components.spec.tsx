/**
 * Phase 5: Agent Action UI Components Tests (TDD)
 *
 * Tests for AgentActionButton, AgentActionModal, AgentStatusPanel.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import {
  AgentActionButton,
  AgentActionModal,
  AgentStatusPanel,
} from '../src/agent/components/index.js';
import { PresenceContext } from '../src/core/PresenceContext.js';
import type { P1Client, RegisteredAgent } from '@pantheon-systems/css-client';
import type { AgentAction, AgentTriggerStatus } from '../src/agent/useAgentTrigger.js';

// =============================================================================
// Mock Data
// =============================================================================

const mockAgent: RegisteredAgent = {
  id: 'agent-123',
  organizationId: 'org-1',
  name: 'Layout Optimizer',
  description: 'Optimizes layouts for mobile',
  capabilities: ['layout', 'responsive'],
  status: 'active',
  settings: {
    maxConcurrentEdits: 1,
    requireHumanApproval: false,
    allowedTriggers: ['human_requested', 'autonomous'],
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockAgent2: RegisteredAgent = {
  id: 'agent-456',
  organizationId: 'org-1',
  name: 'Content Assistant',
  description: 'Helps write content',
  capabilities: ['content', 'writing'],
  status: 'active',
  settings: {
    maxConcurrentEdits: 1,
    requireHumanApproval: true,
    allowedTriggers: ['human_requested'],
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockAction: AgentAction = {
  agentId: 'agent-123',
  intent: 'Optimize layout for mobile',
  targetRegions: ['/content/0', '/content/1'],
};

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(overrides: Partial<P1Client['agentEdit']> = {}): P1Client {
  return {
    agentEdit: {
      canEdit: vi.fn().mockResolvedValue({ allowed: true }),
      startEdit: vi.fn().mockResolvedValue({ sessionId: 'session-123', checkpointId: 'cp-123' }),
      completeEdit: vi.fn().mockResolvedValue({ success: true }),
      abortEdit: vi.fn().mockResolvedValue({ success: true }),
      ...overrides,
    },
    presence: {
      getSitePresence: vi.fn().mockResolvedValue({}),
      getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }),
      getAgentPresence: vi.fn().mockResolvedValue({}),
    },
  } as unknown as P1Client;
}

// =============================================================================
// Test Wrapper
// =============================================================================

function createWrapper(client: P1Client = createMockClient()) {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
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
  };
}

// =============================================================================
// AgentActionButton Tests
// =============================================================================

describe('AgentActionButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render button with children', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize', targetRegions: [] }}
          >
            Run Agent
          </AgentActionButton>
        </Wrapper>
      );

      expect(screen.getByRole('button', { name: 'Run Agent' })).toBeInTheDocument();
    });

    it('should apply variant class', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize', targetRegions: [] }}
            variant="primary"
          >
            Run
          </AgentActionButton>
        </Wrapper>
      );

      const button = screen.getByRole('button');
      expect(button.className).toContain('--primary');
    });

    it('should apply size class', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize', targetRegions: [] }}
            size="lg"
          >
            Run
          </AgentActionButton>
        </Wrapper>
      );

      const button = screen.getByRole('button');
      expect(button.className).toContain('--lg');
    });

    it('should apply custom className', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize', targetRegions: [] }}
            className="custom-class"
          >
            Run
          </AgentActionButton>
        </Wrapper>
      );

      const button = screen.getByRole('button');
      expect(button.className).toContain('custom-class');
    });
  });

  describe('click behavior', () => {
    it('should trigger agent action on click', async () => {
      const client = createMockClient();
      const Wrapper = createWrapper(client);

      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize layout', targetRegions: ['/content/0'] }}
          >
            Run Agent
          </AgentActionButton>
        </Wrapper>
      );

      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(client.agentEdit.canEdit).toHaveBeenCalled();
      });
    });

    it('should show loading state during action', async () => {
      vi.useFakeTimers();

      const client = createMockClient({
        canEdit: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ allowed: true }), 100))
        ),
      });
      const Wrapper = createWrapper(client);

      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize', targetRegions: [] }}
          >
            Run Agent
          </AgentActionButton>
        </Wrapper>
      );

      await fireEvent.click(screen.getByRole('button'));

      // Button should be disabled during loading
      expect(screen.getByRole('button')).toBeDisabled();

      await vi.advanceTimersByTimeAsync(100);

      vi.useRealTimers();
    });

    it('should call onSuccess callback on success', async () => {
      const client = createMockClient();
      const onSuccess = vi.fn();
      const Wrapper = createWrapper(client);

      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize', targetRegions: [] }}
            onSuccess={onSuccess}
          >
            Run Agent
          </AgentActionButton>
        </Wrapper>
      );

      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    it('should call onError callback on failure', async () => {
      const client = createMockClient({
        canEdit: vi.fn().mockResolvedValue({ allowed: false, reason: 'human_active' }),
      });
      const onError = vi.fn();
      const Wrapper = createWrapper(client);

      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize', targetRegions: [] }}
            onError={onError}
          >
            Run Agent
          </AgentActionButton>
        </Wrapper>
      );

      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('human_active');
      });
    });
  });

  describe('disabled state', () => {
    it('should be disabled when disabled prop is true', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionButton
            agent={mockAgent}
            action={{ intent: 'Optimize', targetRegions: [] }}
            disabled
          >
            Run Agent
          </AgentActionButton>
        </Wrapper>
      );

      expect(screen.getByRole('button')).toBeDisabled();
    });
  });
});

// =============================================================================
// AgentActionModal Tests
// =============================================================================

describe('AgentActionModal', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should not render when closed', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={false}
            onClose={() => {}}
            agents={[mockAgent]}
          />
        </Wrapper>
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render when open', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={() => {}}
            agents={[mockAgent]}
          />
        </Wrapper>
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should display list of agents', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={() => {}}
            agents={[mockAgent, mockAgent2]}
          />
        </Wrapper>
      );

      expect(screen.getByText('Layout Optimizer')).toBeInTheDocument();
      expect(screen.getByText('Content Assistant')).toBeInTheDocument();
    });

    it('should have intent input field', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={() => {}}
            agents={[mockAgent]}
          />
        </Wrapper>
      );

      expect(screen.getByLabelText(/intent/i)).toBeInTheDocument();
    });

    it('should show pre-selected target regions', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={() => {}}
            agents={[mockAgent]}
            targetRegions={['/content/0', '/content/1']}
          />
        </Wrapper>
      );

      expect(screen.getByText('/content/0')).toBeInTheDocument();
      expect(screen.getByText('/content/1')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onClose when cancel is clicked', () => {
      const onClose = vi.fn();
      const Wrapper = createWrapper();

      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={onClose}
            agents={[mockAgent]}
          />
        </Wrapper>
      );

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      expect(onClose).toHaveBeenCalled();
    });

    it('should allow selecting an agent', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={() => {}}
            agents={[mockAgent, mockAgent2]}
          />
        </Wrapper>
      );

      // Click on the second agent
      fireEvent.click(screen.getByText('Content Assistant'));

      // Should have selected styling
      const agentItem = screen.getByText('Content Assistant').closest('[class*="agent-item"]');
      expect(agentItem?.className).toContain('--selected');
    });

    it('should allow entering intent', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={() => {}}
            agents={[mockAgent]}
          />
        </Wrapper>
      );

      const input = screen.getByLabelText(/intent/i);
      fireEvent.change(input, { target: { value: 'Optimize for mobile' } });

      expect(input).toHaveValue('Optimize for mobile');
    });

    it('should trigger action on submit', async () => {
      const client = createMockClient();
      const onClose = vi.fn();
      const Wrapper = createWrapper(client);

      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={onClose}
            agents={[mockAgent]}
          />
        </Wrapper>
      );

      // Select agent (first one auto-selected)
      // Enter intent
      const input = screen.getByLabelText(/intent/i);
      fireEvent.change(input, { target: { value: 'Optimize' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /run agent|submit/i }));

      await waitFor(() => {
        expect(client.agentEdit.canEdit).toHaveBeenCalled();
      });
    });

    it('should close modal on successful action', async () => {
      const client = createMockClient();
      const onClose = vi.fn();
      const Wrapper = createWrapper(client);

      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={onClose}
            agents={[mockAgent]}
          />
        </Wrapper>
      );

      const input = screen.getByLabelText(/intent/i);
      fireEvent.change(input, { target: { value: 'Optimize' } });

      fireEvent.click(screen.getByRole('button', { name: /run agent|submit/i }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('validation', () => {
    it('should disable submit when no agent selected', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={() => {}}
            agents={[]}
          />
        </Wrapper>
      );

      expect(screen.getByRole('button', { name: /run agent|submit/i })).toBeDisabled();
    });

    it('should disable submit when intent is empty', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentActionModal
            isOpen={true}
            onClose={() => {}}
            agents={[mockAgent]}
          />
        </Wrapper>
      );

      // Clear intent if any default value
      const input = screen.getByLabelText(/intent/i);
      fireEvent.change(input, { target: { value: '' } });

      expect(screen.getByRole('button', { name: /run agent|submit/i })).toBeDisabled();
    });
  });
});

// =============================================================================
// AgentStatusPanel Tests
// =============================================================================

describe('AgentStatusPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should display agent name', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel agent={mockAgent} status="idle" />
        </Wrapper>
      );

      expect(screen.getByText('Layout Optimizer')).toBeInTheDocument();
    });

    it('should display agent description', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel agent={mockAgent} status="idle" />
        </Wrapper>
      );

      expect(screen.getByText('Optimizes layouts for mobile')).toBeInTheDocument();
    });

    it('should show idle status badge when idle', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel agent={mockAgent} status="idle" />
        </Wrapper>
      );

      expect(screen.getByText(/idle/i)).toBeInTheDocument();
    });

    it('should show active status when action is running', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel
            agent={mockAgent}
            status="editing"
            activeAction={mockAction}
          />
        </Wrapper>
      );

      expect(screen.getByText(/editing|active|running/i)).toBeInTheDocument();
    });

    it('should display current intent when active', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel
            agent={mockAgent}
            status="editing"
            activeAction={mockAction}
          />
        </Wrapper>
      );

      expect(screen.getByText('Optimize layout for mobile')).toBeInTheDocument();
    });

    it('should apply compact mode class', () => {
      const Wrapper = createWrapper();
      const { container } = render(
        <Wrapper>
          <AgentStatusPanel agent={mockAgent} status="idle" compact />
        </Wrapper>
      );

      expect(container.firstChild).toHaveClass(/--compact/);
    });
  });

  describe('cancel button', () => {
    it('should show cancel button when action is active', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel
            agent={mockAgent}
            status="editing"
            activeAction={mockAction}
            onCancel={() => {}}
          />
        </Wrapper>
      );

      expect(screen.getByRole('button', { name: /cancel|stop/i })).toBeInTheDocument();
    });

    it('should not show cancel button when idle', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel agent={mockAgent} status="idle" />
        </Wrapper>
      );

      expect(screen.queryByRole('button', { name: /cancel|stop/i })).not.toBeInTheDocument();
    });

    it('should call onCancel when cancel is clicked', async () => {
      const onCancel = vi.fn();
      const Wrapper = createWrapper();

      render(
        <Wrapper>
          <AgentStatusPanel
            agent={mockAgent}
            status="editing"
            activeAction={mockAction}
            onCancel={onCancel}
          />
        </Wrapper>
      );

      fireEvent.click(screen.getByRole('button', { name: /cancel|stop/i }));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('progress indicator', () => {
    it('should show progress indicator when checking', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel
            agent={mockAgent}
            status="checking"
            activeAction={mockAction}
          />
        </Wrapper>
      );

      expect(screen.getByText(/checking|verifying/i)).toBeInTheDocument();
    });

    it('should show progress indicator when starting', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel
            agent={mockAgent}
            status="starting"
            activeAction={mockAction}
          />
        </Wrapper>
      );

      expect(screen.getByText(/starting/i)).toBeInTheDocument();
    });
  });

  describe('capabilities', () => {
    it('should display agent capabilities', () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <AgentStatusPanel agent={mockAgent} status="idle" />
        </Wrapper>
      );

      expect(screen.getByText('layout')).toBeInTheDocument();
      expect(screen.getByText('responsive')).toBeInTheDocument();
    });
  });
});
