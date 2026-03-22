/**
 * SiteDetailPage Agent Access Tests (TDD - Red Phase)
 *
 * Tests for the Agent Access section on the SiteDetailPage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteDetailPage } from '../../pages/SiteDetailPage';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: () => ({ siteId: 'site-123' }),
  Link: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

// Mock @pantheon-systems/design-toolkit-react
vi.mock('@pantheon-systems/design-toolkit-react', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  RouterLinkButton: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
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

// Mock API modules
vi.mock('../../api/sites', () => ({
  getSite: vi.fn().mockResolvedValue({
    id: 'site-123',
    name: 'Test Site',
    pantheonSiteId: 'pan-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
}));

vi.mock('../../api/branches', () => ({
  listBranches: vi.fn().mockResolvedValue([]),
  createBranch: vi.fn().mockResolvedValue(undefined),
  updateBranch: vi.fn().mockResolvedValue(undefined),
  deleteBranch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../api/collaborators', () => ({
  listCollaborators: vi.fn().mockResolvedValue([]),
  addCollaborator: vi.fn().mockResolvedValue(undefined),
  removeCollaborator: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../api/users', () => ({
  listUsers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/site-tokens', () => ({
  listSiteTokens: vi.fn().mockResolvedValue([]),
  generateSiteToken: vi.fn(),
  revokeSiteToken: vi.fn(),
}));

vi.mock('../../api/site-settings', () => ({
  getSiteSettings: vi.fn().mockResolvedValue({}),
  updateSiteSettings: vi.fn().mockResolvedValue({}),
}));

// Mock agent API with hoisted mocks
const mockListSiteAgentRoles = vi.fn().mockResolvedValue([]);
const mockGrantSiteAgentRole = vi.fn();
const mockRevokeSiteAgentRole = vi.fn();
const mockListAgents = vi.fn().mockResolvedValue([]);

vi.mock('../../api/agents', () => ({
  listSiteAgentRoles: (...args: unknown[]) => mockListSiteAgentRoles(...args),
  grantSiteAgentRole: (...args: unknown[]) => mockGrantSiteAgentRole(...args),
  revokeSiteAgentRole: (...args: unknown[]) => mockRevokeSiteAgentRole(...args),
  listAgents: (...args: unknown[]) => mockListAgents(...args),
  listAgentKeys: vi.fn().mockResolvedValue([]),
  generateAgentKey: vi.fn(),
  revokeAgentKey: vi.fn(),
  registerAgent: vi.fn(),
  deleteAgent: vi.fn(),
  updateAgentStatus: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockListSiteAgentRoles.mockResolvedValue([]);
  mockListAgents.mockResolvedValue([]);
});

describe('Agent Access Section', () => {
  it('should render "Agent Access" section heading', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-access-section')).toBeInTheDocument();
    });
    expect(screen.getByText('Agent Access')).toBeInTheDocument();
  });

  it('should show empty state when no agent roles exist', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-roles-empty')).toBeInTheDocument();
    });
  });

  it('should render agent roles table with role data', async () => {
    mockListSiteAgentRoles.mockResolvedValue([
      {
        id: 'role-1',
        agentId: 'agent-1',
        agentName: 'Deploy Bot',
        siteId: 'site-123',
        role: 'editor',
        grantedAt: '2026-01-15T00:00:00Z',
      },
      {
        id: 'role-2',
        agentId: 'agent-2',
        agentName: 'CI Agent',
        siteId: 'site-123',
        role: 'admin',
        grantedAt: '2026-02-20T00:00:00Z',
      },
    ]);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-roles-table')).toBeInTheDocument();
    });
    expect(screen.getByText('Deploy Bot')).toBeInTheDocument();
    expect(screen.getByText('CI Agent')).toBeInTheDocument();
    expect(screen.getByTestId('agent-role-row-role-1')).toBeInTheDocument();
    expect(screen.getByTestId('agent-role-row-role-2')).toBeInTheDocument();
  });

  it('should show grant form when "Grant access" button is clicked', async () => {
    const user = userEvent.setup();
    mockListAgents.mockResolvedValue([
      { id: 'agent-1', name: 'Deploy Bot', status: 'active' },
      { id: 'agent-2', name: 'CI Agent', status: 'active' },
    ]);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('grant-agent-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('grant-agent-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-select')).toBeInTheDocument();
      expect(screen.getByTestId('agent-role-select')).toBeInTheDocument();
      expect(screen.getByTestId('submit-grant-btn')).toBeInTheDocument();
    });
  });

  it('should grant agent role and refresh list', async () => {
    const user = userEvent.setup();
    mockListAgents.mockResolvedValue([
      { id: 'agent-1', name: 'Deploy Bot', status: 'active' },
    ]);
    mockGrantSiteAgentRole.mockResolvedValue({
      id: 'role-new',
      agentId: 'agent-1',
      agentName: 'Deploy Bot',
      siteId: 'site-123',
      role: 'editor',
      grantedAt: '2026-03-22T00:00:00Z',
    });

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('grant-agent-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('grant-agent-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('agent-select')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('agent-select'), 'agent-1');
    await user.selectOptions(screen.getByTestId('agent-role-select'), 'editor');
    await user.click(screen.getByTestId('submit-grant-btn'));

    await waitFor(() => {
      expect(mockGrantSiteAgentRole).toHaveBeenCalledWith('site-123', {
        agentId: 'agent-1',
        role: 'editor',
      });
    });
  });

  it('should revoke an agent role', async () => {
    const user = userEvent.setup();
    mockListSiteAgentRoles.mockResolvedValue([
      {
        id: 'role-1',
        agentId: 'agent-1',
        agentName: 'Deploy Bot',
        siteId: 'site-123',
        role: 'editor',
        grantedAt: '2026-01-15T00:00:00Z',
      },
    ]);
    mockRevokeSiteAgentRole.mockResolvedValue(undefined);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('revoke-role-role-1')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('revoke-role-role-1'));

    // ConfirmDeleteModal requires typing the resource name
    await waitFor(() => {
      expect(screen.getByTestId('confirm-input')).toBeInTheDocument();
    });
    await user.type(screen.getByTestId('confirm-input'), 'Deploy Bot');
    await user.click(screen.getByTestId('delete-button'));

    await waitFor(() => {
      expect(mockRevokeSiteAgentRole).toHaveBeenCalledWith('site-123', 'role-1');
    });
  });
});
