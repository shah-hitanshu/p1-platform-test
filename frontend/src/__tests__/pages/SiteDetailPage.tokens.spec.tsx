/**
 * SiteDetailPage API Tokens Tests (TDD - Red Phase)
 *
 * Tests for the API Tokens section on the SiteDetailPage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteDetailPage } from '../../pages/SiteDetailPage';
import type { SiteApiToken } from '../../types';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: () => ({ siteId: 'site-123' }),
  useNavigate: () => vi.fn(),
  Link: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

// Mock @pantheon-systems/pds-toolkit-react
vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Breadcrumb: ({ crumbs, ...props }: Record<string, unknown>) => (
    <nav {...props}>{(crumbs as React.ReactNode[]).map((c, i) => <span key={i}>{c}</span>)}</nav>
  ),
  Spinner: ({ label, ...props }: Record<string, unknown>) => (
    <div role="status" aria-label={label as string} {...props} />
  ),
  Button: ({ label, children, onClick, disabled, isLoading, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      disabled={(disabled as boolean) || (isLoading as boolean)}
      {...props}
    >
      {(label as string) || (children as React.ReactNode)}
    </button>
  ),
  ButtonLink: ({ linkContent, children, ...props }: Record<string, unknown>) => (
    <div {...props}>{(linkContent as React.ReactNode) || (children as React.ReactNode)}</div>
  ),
  InlineMessage: ({ title, children, ...props }: Record<string, unknown>) => (
    <div role="alert" {...props}>{(title as string)}{(children as React.ReactNode)}</div>
  ),
  StatusBadge: ({ label, children, ...props }: Record<string, unknown>) => (
    <span {...props}>{(label as string) || (children as React.ReactNode)}</span>
  ),
  Modal: ({ children, modalIsOpen, ...props }: Record<string, unknown>) =>
    (modalIsOpen as boolean) ? <div {...props}>{children as React.ReactNode}</div> : null,
  Panel: ({ children, className, ...props }: Record<string, unknown>) => (
    <div className={className as string} {...props}>{children as React.ReactNode}</div>
  ),
  CompactEmptyState: ({ heading, message, linkContent, className, ...props }: Record<string, unknown>) => (
    <div className={className as string} {...props}>
      <span>{heading as string}</span>
      {message && <p>{message as string}</p>}
      {linkContent as React.ReactNode}
    </div>
  ),
  TextInput: ({ label, value, onChange, disabled, placeholder, id, validationMessage, inputProps, ...props }: Record<string, unknown>) => (
    <div>
      <label htmlFor={id as string}>{label as React.ReactNode}</label>
      <input
        id={id as string}
        value={value as string}
        onChange={onChange as React.ChangeEventHandler<HTMLInputElement>}
        disabled={disabled as boolean}
        placeholder={placeholder as string}
        {...(inputProps as Record<string, unknown>)}
        {...props}
      />
      {validationMessage && <span>{validationMessage as string}</span>}
    </div>
  ),
  Select: ({ label, value, options, onOptionSelect, disabled, showLabel, id, ...props }: Record<string, unknown>) => (
    <div>
      {(showLabel !== false) && <label htmlFor={id as string}>{label as string}</label>}
      <select
        id={id as string}
        value={value as string}
        onChange={(e) => (onOptionSelect as (opt: { label: string; value: string }) => void)?.({ label: e.target.value, value: e.target.value })}
        disabled={disabled as boolean}
        {...props}
      >
        {((options as Array<{ label: string; value: string }>) ?? []).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
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
  deleteSite: vi.fn().mockResolvedValue(undefined),
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

describe('API Tokens Section', () => {
  it('should render the API Tokens section header', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('section-title-tokens')).toBeInTheDocument();
    });
    expect(screen.getByTestId('section-title-tokens')).toHaveTextContent('API Tokens');
  });

  it('should show empty state when no tokens exist', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tokens-empty-state')).toBeInTheDocument();
    });
  });

  it('should display tokens in a table', async () => {
    const tokens: SiteApiToken[] = [
      {
        id: 'tok-1',
        siteId: 'site-123',
        prefix: 'sat_abc1',
        name: 'CI Token',
        scopes: ['read:published'],
        createdBy: 'user-1',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsedAt: '2026-03-01T00:00:00Z',
        revokedAt: null,
      },
      {
        id: 'tok-2',
        siteId: 'site-123',
        prefix: 'sat_def2',
        name: 'Preview Token',
        scopes: ['read:draft'],
        createdBy: 'user-1',
        createdAt: '2026-02-01T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ];
    mockListSiteTokens.mockResolvedValue(tokens);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('tokens-table')).toBeInTheDocument();
    });
    expect(screen.getByText('CI Token')).toBeInTheDocument();
    expect(screen.getByText('Preview Token')).toBeInTheDocument();
  });

  it('should show create token form when button is clicked', async () => {
    const user = userEvent.setup();

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-token-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-token-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-token-form')).toBeInTheDocument();
    });
  });

  it('should call generateSiteToken and show the raw token', async () => {
    const user = userEvent.setup();
    mockGenerateSiteToken.mockResolvedValue({
      id: 'new-tok',
      token: 'sat_rawtoken123',
      name: 'New Token',
      prefix: 'sat_rawt',
      scopes: ['read:published'],
      createdAt: '2026-03-06T00:00:00Z',
    });

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('create-token-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-token-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('token-name-input')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('token-name-input'), 'New Token');
    await user.click(screen.getByTestId('submit-token-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('raw-token-display')).toBeInTheDocument();
    });
  });

  it('should call revokeSiteToken when revoke is confirmed', async () => {
    const user = userEvent.setup();
    const tokens: SiteApiToken[] = [
      {
        id: 'tok-1',
        siteId: 'site-123',
        prefix: 'sat_abc1',
        name: 'CI Token',
        scopes: ['read:published'],
        createdBy: 'user-1',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsedAt: '2026-03-01T00:00:00Z',
        revokedAt: null,
      },
    ];
    mockListSiteTokens.mockResolvedValue(tokens);
    mockRevokeSiteToken.mockResolvedValue(undefined);

    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('revoke-token-tok-1')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('revoke-token-tok-1'));

    // ConfirmDeleteModal requires typing the resource name
    await waitFor(() => {
      expect(screen.getByTestId('confirm-input')).toBeInTheDocument();
    });
    await user.type(screen.getByTestId('confirm-input'), 'CI Token');
    await user.click(screen.getByTestId('delete-button'));

    await waitFor(() => {
      expect(mockRevokeSiteToken).toHaveBeenCalledWith('site-123', 'tok-1');
    });
  });
});
