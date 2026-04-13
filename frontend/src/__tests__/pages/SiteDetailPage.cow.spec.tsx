/**
 * SiteDetailPage Copy-on-Write Branching Tests (TDD - Red Phase)
 *
 * Tests for the copy-on-write branching changes:
 * - No parent branch selector (branches always come from main)
 * - "Create branch from main" button text
 * - "Source" column header instead of "Parent"
 * - Non-main branches show "main" in the Source column
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteDetailPage } from '../../pages/SiteDetailPage';
import type { Branch } from '../../types';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: () => ({ siteId: 'site-123' }),
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
}));

const mainBranch: Branch = {
  id: 'branch-main-id',
  siteId: 'site-123',
  name: 'main',
  isMain: true,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const featureBranch: Branch = {
  id: 'branch-feature-id',
  siteId: 'site-123',
  name: 'feature-one',
  isMain: false,
  sourceBranchId: 'branch-main-id',
  status: 'active',
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

const mockListBranches = vi.fn().mockResolvedValue([mainBranch, featureBranch]);
const mockCreateBranch = vi.fn().mockResolvedValue(undefined);

vi.mock('../../api/branches', () => ({
  listBranches: (...args: unknown[]) => mockListBranches(...args),
  createBranch: (...args: unknown[]) => mockCreateBranch(...args),
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
  generateSiteToken: vi.fn().mockResolvedValue(undefined),
  revokeSiteToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../api/site-settings', () => ({
  getSiteSettings: vi.fn().mockResolvedValue({}),
  updateSiteSettings: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockListBranches.mockResolvedValue([mainBranch, featureBranch]);
  mockCreateBranch.mockResolvedValue(featureBranch);
});

describe('Copy-on-Write Branching - Create Branch Form', () => {
  it('should NOT render a parent branch selector in the create form', async () => {
    const user = userEvent.setup();

    render(<SiteDetailPage />);

    // Wait for branches to load
    await waitFor(() => {
      expect(screen.getByTestId('branches-table')).toBeInTheDocument();
    });

    // Open create form
    await user.click(screen.getByTestId('create-branch-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-branch-form')).toBeInTheDocument();
    });

    // Parent branch selector should NOT exist
    expect(screen.queryByTestId('parent-branch-select')).not.toBeInTheDocument();
  });

  it('should show "Create branch from main" button text', async () => {
    const user = userEvent.setup();

    render(<SiteDetailPage />);

    // Wait for branches to load
    await waitFor(() => {
      expect(screen.getByTestId('branches-table')).toBeInTheDocument();
    });

    // Open create form
    await user.click(screen.getByTestId('create-branch-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-branch-form')).toBeInTheDocument();
    });

    // Fill the branch name so the submit button is enabled
    await user.type(screen.getByTestId('branch-name-input'), 'new-feature');

    // Submit button should say "Create branch from main"
    expect(screen.getByTestId('submit-branch-btn')).toHaveTextContent('Create branch from main');
  });
});

describe('Copy-on-Write Branching - Branches Table', () => {
  it('should show "Source" column header instead of "Parent"', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('branches-table')).toBeInTheDocument();
    });

    const table = screen.getByTestId('branches-table');

    // Should have "Source" header, not "Parent"
    expect(table).toHaveTextContent('Source');
    expect(table).not.toHaveTextContent('Parent');
  });

  it('should show "main" text in the Source column for non-main branches', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('branches-table')).toBeInTheDocument();
    });

    // The feature branch row should display "main" in the Source column,
    // not a truncated UUID like "branch-ma..."
    const featureRow = screen.getByTestId(`branch-row-${featureBranch.id}`);
    expect(featureRow).toHaveTextContent('main');

    // It should NOT show truncated UUID format
    expect(featureRow).not.toHaveTextContent('branch-ma...');
    expect(featureRow).not.toHaveTextContent(featureBranch.sourceBranchId!.slice(0, 8));
  });

  it('should show "-" in the Source column for the main branch', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('branches-table')).toBeInTheDocument();
    });

    const mainRow = screen.getByTestId(`branch-row-${mainBranch.id}`);
    // Main branch has no source, should show "-"
    expect(mainRow).toHaveTextContent('-');
  });
});
