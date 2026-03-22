/**
 * AgentsPage Tests (TDD - Red Phase)
 *
 * Tests for the system-level Agents management page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentsPage } from '../../pages/AgentsPage';
import type { RegisteredAgent, AgentApiKey } from '../../types';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  Link: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

// Mock @pantheon-systems/design-toolkit-react
vi.mock('@pantheon-systems/design-toolkit-react', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  Alert: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Tag: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <span {...props}>{children}</span>
  ),
  Modal: ({ children, isOpen, ...props }: { children: React.ReactNode; isOpen: boolean; [key: string]: unknown }) =>
    isOpen ? <div {...props}>{children}</div> : null,
  ModalHeader: ({ title, ...props }: { title: string; [key: string]: unknown }) => (
    <div {...props}>{title}</div>
  ),
  ModalContent: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

// Mock agent API with hoisted mocks
const mockListAgents = vi.fn().mockResolvedValue([]);
const mockRegisterAgent = vi.fn();
const mockDeleteAgent = vi.fn();
const mockUpdateAgentStatus = vi.fn();
const mockListAgentKeys = vi.fn().mockResolvedValue([]);
const mockGenerateAgentKey = vi.fn();
const mockRevokeAgentKey = vi.fn();

vi.mock('../../api/agents', () => ({
  listAgents: (...args: unknown[]) => mockListAgents(...args),
  registerAgent: (...args: unknown[]) => mockRegisterAgent(...args),
  deleteAgent: (...args: unknown[]) => mockDeleteAgent(...args),
  updateAgentStatus: (...args: unknown[]) => mockUpdateAgentStatus(...args),
  listAgentKeys: (...args: unknown[]) => mockListAgentKeys(...args),
  generateAgentKey: (...args: unknown[]) => mockGenerateAgentKey(...args),
  revokeAgentKey: (...args: unknown[]) => mockRevokeAgentKey(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockListAgents.mockResolvedValue([]);
  mockListAgentKeys.mockResolvedValue([]);
});

const sampleAgents: RegisteredAgent[] = [
  {
    id: 'agent-1',
    organizationId: 'org-1',
    name: 'Content Bot',
    description: 'Automated content management agent',
    capabilities: ['read', 'write'],
    status: 'active',
    settings: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'agent-2',
    organizationId: 'org-1',
    name: 'Deploy Agent',
    description: 'Handles deployment tasks',
    capabilities: ['deploy'],
    status: 'suspended',
    settings: {},
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  },
];

const sampleKeys: AgentApiKey[] = [
  {
    id: 'key-1',
    agentId: 'agent-1',
    prefix: 'aak_abc1',
    name: 'Primary Key',
    createdBy: 'user-1',
    createdAt: '2026-01-15T00:00:00Z',
    lastUsedAt: '2026-03-01T00:00:00Z',
    revokedAt: null,
  },
  {
    id: 'key-2',
    agentId: 'agent-1',
    prefix: 'aak_def2',
    name: 'Backup Key',
    createdBy: 'user-1',
    createdAt: '2026-02-15T00:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
  },
];

describe('AgentsPage', () => {
  describe('Rendering', () => {
    it('should render page title "Agents" and subtitle', async () => {
      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('page-title')).toBeInTheDocument();
      });
      expect(screen.getByTestId('page-title')).toHaveTextContent('Agents');
    });

    it('should show empty state when no agents exist', async () => {
      mockListAgents.mockResolvedValue([]);

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
    });

    it('should render agents table with agent data', async () => {
      mockListAgents.mockResolvedValue(sampleAgents);

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('agents-table')).toBeInTheDocument();
      });
      expect(screen.getByText('Content Bot')).toBeInTheDocument();
      expect(screen.getByText('Deploy Agent')).toBeInTheDocument();
      expect(screen.getByTestId('agent-row-agent-1')).toBeInTheDocument();
      expect(screen.getByTestId('agent-row-agent-2')).toBeInTheDocument();
    });
  });

  describe('Register agent', () => {
    it('should show register form when button clicked', async () => {
      const user = userEvent.setup();

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('register-agent-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('register-agent-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('agent-name-input')).toBeInTheDocument();
      });
    });

    it('should register new agent and refresh list', async () => {
      const user = userEvent.setup();
      const newAgent: RegisteredAgent = {
        id: 'agent-new',
        organizationId: 'org-1',
        name: 'New Agent',
        description: 'A new automation agent',
        capabilities: [],
        status: 'active',
        settings: {},
        createdAt: '2026-03-22T00:00:00Z',
        updatedAt: '2026-03-22T00:00:00Z',
      };
      mockRegisterAgent.mockResolvedValue(newAgent);
      // After registration, the list should be refreshed with the new agent
      mockListAgents
        .mockResolvedValueOnce([]) // initial load
        .mockResolvedValueOnce([newAgent]); // after registration

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('register-agent-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('register-agent-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('agent-name-input')).toBeInTheDocument();
      });

      await user.type(screen.getByTestId('agent-name-input'), 'New Agent');
      await user.click(screen.getByTestId('submit-agent-btn'));

      await waitFor(() => {
        expect(mockRegisterAgent).toHaveBeenCalled();
      });

      // List should be refreshed
      await waitFor(() => {
        expect(mockListAgents).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Agent keys', () => {
    it('should show agent keys when row is expanded', async () => {
      const user = userEvent.setup();
      mockListAgents.mockResolvedValue(sampleAgents);
      mockListAgentKeys.mockResolvedValue(sampleKeys);

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('expand-keys-agent-1')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('expand-keys-agent-1'));

      await waitFor(() => {
        expect(screen.getByTestId('key-row-key-1')).toBeInTheDocument();
      });
      expect(screen.getByTestId('key-row-key-2')).toBeInTheDocument();
      expect(screen.getByText('Primary Key')).toBeInTheDocument();
      expect(screen.getByText('Backup Key')).toBeInTheDocument();
    });

    it('should generate a new key and show it once', async () => {
      const user = userEvent.setup();
      mockListAgents.mockResolvedValue(sampleAgents);
      mockListAgentKeys.mockResolvedValue([]);
      mockGenerateAgentKey.mockResolvedValue({
        id: 'key-new',
        agentId: 'agent-1',
        token: 'aak_rawtoken123',
        prefix: 'aak_rawt',
        name: 'New Key',
        createdBy: 'user-1',
        createdAt: '2026-03-22T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      });

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('expand-keys-agent-1')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('expand-keys-agent-1'));

      await waitFor(() => {
        expect(screen.getByTestId('generate-key-btn-agent-1')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('generate-key-btn-agent-1'));

      await waitFor(() => {
        expect(mockGenerateAgentKey).toHaveBeenCalledWith('agent-1');
      });

      // The raw token should be displayed once for the user to copy
      await waitFor(() => {
        expect(screen.getByText('aak_rawtoken123')).toBeInTheDocument();
      });
    });
  });

  describe('Agent status', () => {
    it('should update agent status via dropdown', async () => {
      const user = userEvent.setup();
      mockListAgents.mockResolvedValue(sampleAgents);
      mockUpdateAgentStatus.mockResolvedValue({
        ...sampleAgents[0],
        status: 'disabled',
      });

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('status-select-agent-1')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('status-select-agent-1'), 'disabled');

      await waitFor(() => {
        expect(mockUpdateAgentStatus).toHaveBeenCalledWith('agent-1', 'disabled');
      });
    });
  });

  describe('Delete agent', () => {
    it('should show confirm modal and delete agent', async () => {
      const user = userEvent.setup();
      mockListAgents.mockResolvedValue(sampleAgents);
      mockDeleteAgent.mockResolvedValue(undefined);

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('delete-agent-agent-1')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('delete-agent-agent-1'));

      // ConfirmDeleteModal requires typing the resource name
      await waitFor(() => {
        expect(screen.getByTestId('confirm-input')).toBeInTheDocument();
      });
      await user.type(screen.getByTestId('confirm-input'), 'Content Bot');
      await user.click(screen.getByTestId('delete-button'));

      await waitFor(() => {
        expect(mockDeleteAgent).toHaveBeenCalledWith('agent-1');
      });
    });
  });

  describe('Revoke agent key', () => {
    it('should revoke an agent key', async () => {
      const user = userEvent.setup();
      mockListAgents.mockResolvedValue(sampleAgents);
      mockListAgentKeys.mockResolvedValue(sampleKeys);
      mockRevokeAgentKey.mockResolvedValue(undefined);

      render(<AgentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('expand-keys-agent-1')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('expand-keys-agent-1'));

      await waitFor(() => {
        expect(screen.getByTestId('revoke-key-key-1')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('revoke-key-key-1'));

      await waitFor(() => {
        expect(mockRevokeAgentKey).toHaveBeenCalledWith('agent-1', 'key-1');
      });
    });
  });
});
