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
