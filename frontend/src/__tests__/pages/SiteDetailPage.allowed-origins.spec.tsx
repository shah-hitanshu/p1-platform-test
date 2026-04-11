/**
 * SiteDetailPage Allowed Origins Tests (TDD - Red Phase)
 *
 * Tests for the Allowed Origins section on the SiteDetailPage.
 * Allowed origins control which redirect URIs are accepted by the CSS auth server.
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

// Hoisted mocks for sites API (needed for updateSite control)
const mockGetSite = vi.fn();
const mockUpdateSite = vi.fn();

vi.mock('../../api/sites', () => ({
  getSite: (...args: unknown[]) => mockGetSite(...args),
  updateSite: (...args: unknown[]) => mockUpdateSite(...args),
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

vi.mock('../../api/agents', () => ({
  listSiteAgentRoles: vi.fn().mockResolvedValue([]),
  grantSiteAgentRole: vi.fn(),
  revokeSiteAgentRole: vi.fn(),
  listAgents: vi.fn().mockResolvedValue([]),
}));

const baseSite = {
  id: 'site-123',
  name: 'Test Site',
  pantheonSiteId: 'pan-123',
  allowedOrigins: [] as string[],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSite.mockResolvedValue({ ...baseSite, allowedOrigins: [] });
  mockUpdateSite.mockResolvedValue({ ...baseSite, allowedOrigins: [] });
});

describe('Allowed Origins Section', () => {
  it('should render "Allowed Origins" section header', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('allowed-origins-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('section-title-allowed-origins')).toHaveTextContent('Allowed Origins');
  });

  it('should show empty state warning when no origins exist', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('allowed-origins-empty')).toBeInTheDocument();
    });
  });

  it('should display a warning that empty allowed origins blocks OAuth', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('allowed-origins-empty-warning')).toBeInTheDocument();
    });
  });

  it('should display origins in a table when they exist', async () => {
    mockGetSite.mockResolvedValue({
      ...baseSite,
      allowedOrigins: [
        'https://example.com',
        '*-mysite.pantheonsite.io',
      ],
    });

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('allowed-origins-table')).toBeInTheDocument();
    });
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('*-mysite.pantheonsite.io')).toBeInTheDocument();
  });

  it('should show add origin form when "Add origin" button is clicked', async () => {
    const user = userEvent.setup();

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-origin-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-origin-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('add-origin-form')).toBeInTheDocument();
      expect(screen.getByTestId('origin-input')).toBeInTheDocument();
      expect(screen.getByTestId('submit-origin-btn')).toBeInTheDocument();
    });
  });

  it('should disable submit button when origin input is empty', async () => {
    const user = userEvent.setup();

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-origin-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-origin-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('submit-origin-btn')).toBeDisabled();
    });
  });

  it('should call updateSite with new origin appended to existing list', async () => {
    const user = userEvent.setup();
    mockGetSite.mockResolvedValue({
      ...baseSite,
      allowedOrigins: ['https://existing.com'],
    });
    mockUpdateSite.mockResolvedValue({
      ...baseSite,
      allowedOrigins: ['https://existing.com', 'https://new.example.com'],
    });

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-origin-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-origin-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('origin-input')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('origin-input'), 'https://new.example.com');
    await user.click(screen.getByTestId('submit-origin-btn'));

    await waitFor(() => {
      expect(mockUpdateSite).toHaveBeenCalledWith('site-123', {
        allowedOrigins: ['https://existing.com', 'https://new.example.com'],
      });
    });
  });

  it('should close the add form and clear input after successful submission', async () => {
    const user = userEvent.setup();
    mockUpdateSite.mockResolvedValue({
      ...baseSite,
      allowedOrigins: ['https://new.example.com'],
    });

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-origin-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-origin-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('origin-input')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('origin-input'), 'https://new.example.com');
    await user.click(screen.getByTestId('submit-origin-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('add-origin-form')).not.toBeInTheDocument();
    });
  });

  it('should call updateSite with origin removed when remove is confirmed', async () => {
    const user = userEvent.setup();
    mockGetSite.mockResolvedValue({
      ...baseSite,
      allowedOrigins: ['https://example.com', 'https://other.com'],
    });
    mockUpdateSite.mockResolvedValue({
      ...baseSite,
      allowedOrigins: ['https://other.com'],
    });

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('remove-origin-0')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('remove-origin-0'));

    // ConfirmDeleteModal requires typing the resource name
    await waitFor(() => {
      expect(screen.getByTestId('confirm-input')).toBeInTheDocument();
    });
    await user.type(screen.getByTestId('confirm-input'), 'https://example.com');
    await user.click(screen.getByTestId('delete-button'));

    await waitFor(() => {
      expect(mockUpdateSite).toHaveBeenCalledWith('site-123', {
        allowedOrigins: ['https://other.com'],
      });
    });
  });

  it('should re-fetch site data after adding an origin', async () => {
    const user = userEvent.setup();
    mockUpdateSite.mockResolvedValue({
      ...baseSite,
      allowedOrigins: ['https://new.example.com'],
    });

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('add-origin-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-origin-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('origin-input')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('origin-input'), 'https://new.example.com');
    await user.click(screen.getByTestId('submit-origin-btn'));

    await waitFor(() => {
      // getSite called once on mount, once after update
      expect(mockGetSite).toHaveBeenCalledTimes(2);
    });
  });
});
