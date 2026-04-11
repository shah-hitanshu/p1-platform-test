/**
 * SiteDetailPage Scope Selection Tests (TDD - Red Phase)
 *
 * Tests for scope selection integration in the token generation form
 * and scope badge display with color coding in the token table.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteDetailPage } from '../../pages/SiteDetailPage';
import type { SiteApiToken } from '../../types';

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
  Tag: ({ children, type, ...props }: { children: React.ReactNode; type?: string; [key: string]: unknown }) => (
    <span data-tag-type={type} {...props}>{children}</span>
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
    allowedOrigins: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  updateSite: vi.fn().mockResolvedValue({
    id: 'site-123',
    name: 'Test Site',
    pantheonSiteId: 'pan-123',
    allowedOrigins: [],
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

// Mock site-tokens with hoisted mocks
const mockListSiteTokens = vi.fn().mockResolvedValue([]);
const mockGenerateSiteToken = vi.fn();
const mockRevokeSiteToken = vi.fn();
vi.mock('../../api/site-tokens', () => ({
  listSiteTokens: (...args: unknown[]) => mockListSiteTokens(...args),
  generateSiteToken: (...args: unknown[]) => mockGenerateSiteToken(...args),
  revokeSiteToken: (...args: unknown[]) => mockRevokeSiteToken(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockListSiteTokens.mockResolvedValue([]);
});

describe('Token Scope Selection', () => {
  it('should include scope selector in the token creation form', async () => {
    const user = userEvent.setup();

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-token-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-token-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
    });
  });

  it('should default to read:published scope when form opens', async () => {
    const user = userEvent.setup();

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-token-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-token-btn'));

    await waitFor(() => {
      expect(screen.getByLabelText('Published content (main branch only)')).toBeChecked();
    });
  });

  it('should include selected scopes in token generation request', async () => {
    const user = userEvent.setup();
    mockGenerateSiteToken.mockResolvedValue({
      id: 'new-tok',
      token: 'sat_scopedtoken123',
      name: 'Scoped Token',
      prefix: 'sat_scop',
      scopes: ['read:all'],
      createdAt: '2026-03-07T00:00:00Z',
    });

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-token-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-token-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('token-name-input')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('token-name-input'), 'Scoped Token');

    // Select "All branch content" scope (which should supersede read:published)
    await user.click(screen.getByLabelText('All branch content'));

    await user.click(screen.getByTestId('submit-token-btn'));

    await waitFor(() => {
      expect(mockGenerateSiteToken).toHaveBeenCalledWith(
        'site-123',
        expect.objectContaining({
          scopes: ['read:all'],
        }),
      );
    });
  });
});

describe('Token Scope Badge Display', () => {
  it('should show read:published scope with default tag type', async () => {
    const tokens: SiteApiToken[] = [
      {
        id: 'tok-pub',
        siteId: 'site-123',
        prefix: 'sat_pub1',
        name: 'Published Token',
        scopes: ['read:published'],
        createdBy: 'user-1',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ];
    mockListSiteTokens.mockResolvedValue(tokens);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tokens-table')).toBeInTheDocument();
    });

    const scopeBadge = screen.getByTestId('scope-badge-tok-pub-read:published');
    expect(scopeBadge).toBeInTheDocument();
    expect(scopeBadge).toHaveAttribute('data-tag-type', 'default');
  });

  it('should show read:all scope with info tag type', async () => {
    const tokens: SiteApiToken[] = [
      {
        id: 'tok-all',
        siteId: 'site-123',
        prefix: 'sat_all1',
        name: 'All Branches Token',
        scopes: ['read:all'],
        createdBy: 'user-1',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ];
    mockListSiteTokens.mockResolvedValue(tokens);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tokens-table')).toBeInTheDocument();
    });

    const scopeBadge = screen.getByTestId('scope-badge-tok-all-read:all');
    expect(scopeBadge).toBeInTheDocument();
    expect(scopeBadge).toHaveAttribute('data-tag-type', 'info');
  });

  it('should show read:draft scope with success tag type', async () => {
    const tokens: SiteApiToken[] = [
      {
        id: 'tok-draft',
        siteId: 'site-123',
        prefix: 'sat_dft1',
        name: 'Draft Token',
        scopes: ['read:draft'],
        createdBy: 'user-1',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ];
    mockListSiteTokens.mockResolvedValue(tokens);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tokens-table')).toBeInTheDocument();
    });

    const scopeBadge = screen.getByTestId('scope-badge-tok-draft-read:draft');
    expect(scopeBadge).toBeInTheDocument();
    expect(scopeBadge).toHaveAttribute('data-tag-type', 'success');
  });

  it('should show multiple scope badges for tokens with multiple scopes', async () => {
    const tokens: SiteApiToken[] = [
      {
        id: 'tok-multi',
        siteId: 'site-123',
        prefix: 'sat_mul1',
        name: 'Multi-Scope Token',
        scopes: ['read:all', 'read:draft'],
        createdBy: 'user-1',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ];
    mockListSiteTokens.mockResolvedValue(tokens);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tokens-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('scope-badge-tok-multi-read:all')).toBeInTheDocument();
    expect(screen.getByTestId('scope-badge-tok-multi-read:draft')).toBeInTheDocument();
  });
});
