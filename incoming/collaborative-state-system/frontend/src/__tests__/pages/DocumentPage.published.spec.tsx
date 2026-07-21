/**
 * DocumentPage isPublished Tests (TDD - Red Phase)
 *
 * Tests for the isPublished frontend changes:
 * - "Published" badge on versions where isPublished is true
 * - "Unpublished" indicator in the document header when no versions are published
 * - No "Unpublished" indicator when at least one version is published
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DocumentPage } from '../../pages/DocumentPage';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: () => ({
    siteId: 'site-123',
    branchId: 'branch-456',
    documentId: 'doc-789',
  }),
  Link: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
}));

// Mock @pantheon-systems/pds-toolkit-react
vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
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
  Tabs: ({ tabs, ...props }: Record<string, unknown>) => (
    <div {...props}>
      {((tabs as Array<{ tabLabel: string; tabId: string; panelContent: React.ReactNode }>) || []).map(
        (tab: { tabLabel: string; tabId: string; panelContent: React.ReactNode }) => (
          <div key={tab.tabId}>{tab.panelContent}</div>
        )
      )}
    </div>
  ),
  Panel: ({ children, className, ...props }: Record<string, unknown>) => (
    <div className={className as string} {...props}>{children as React.ReactNode}</div>
  ),
  Breadcrumb: ({ crumbs, ...props }: Record<string, unknown>) => (
    <nav {...props}>
      {((crumbs as Array<{ label: string; href?: string }>) || []).map(
        (crumb: { label: string; href?: string }, i: number) => (
          <span key={i}>{crumb.label}</span>
        )
      )}
    </nav>
  ),
  CompactEmptyState: ({ heading, message, linkContent, className, ...props }: Record<string, unknown>) => (
    <div className={className as string} {...props}>
      <span>{heading as string}</span>
      {message && <p>{message as string}</p>}
      {linkContent as React.ReactNode}
    </div>
  ),
  Textarea: ({ label, value, onChange, disabled, rows, id, validationMessage, ...props }: Record<string, unknown>) => (
    <div {...props}>
      <label htmlFor={id as string}>{label as string}</label>
      <textarea
        id={id as string}
        value={value as string}
        onChange={onChange as React.ChangeEventHandler<HTMLTextAreaElement>}
        disabled={disabled as boolean}
        rows={rows as number}
      />
      {validationMessage && <span>{validationMessage as string}</span>}
    </div>
  ),
}));

// Mock API modules
const mockGetSite = vi.fn().mockResolvedValue({
  id: 'site-123',
  name: 'Test Site',
  pantheonSiteId: 'pan-123',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const mockGetBranch = vi.fn().mockResolvedValue({
  id: 'branch-456',
  siteId: 'site-123',
  name: 'main',
  isMain: true,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const mockGetDocument = vi.fn().mockResolvedValue({
  id: 'doc-789',
  siteId: 'site-123',
  path: 'pages/about',
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
});

const mockGetLatestDocumentVersion = vi.fn();
const mockListDocumentVersions = vi.fn();
const mockCreateDocumentVersion = vi.fn();

vi.mock('../../api/sites', () => ({
  getSite: (...args: unknown[]) => mockGetSite(...args),
}));

vi.mock('../../api/branches', () => ({
  getBranch: (...args: unknown[]) => mockGetBranch(...args),
}));

vi.mock('../../api/documents', () => ({
  getDocument: (...args: unknown[]) => mockGetDocument(...args),
  getLatestDocumentVersion: (...args: unknown[]) => mockGetLatestDocumentVersion(...args),
  listDocumentVersions: (...args: unknown[]) => mockListDocumentVersions(...args),
  createDocumentVersion: (...args: unknown[]) => mockCreateDocumentVersion(...args),
}));

const publishedVersion = {
  id: 'ver-1',
  documentId: 'doc-789',
  branchId: 'branch-456',
  versionNumber: 1,
  snapshot: { title: 'About' },
  source: 'edit',
  createdById: 'user-abc-1234-5678',
  createdByType: 'user' as const,
  createdAt: '2026-01-01T00:00:00Z',
  isPublished: true,
};

const unpublishedVersion = {
  id: 'ver-2',
  documentId: 'doc-789',
  branchId: 'branch-456',
  versionNumber: 2,
  snapshot: { title: 'About Updated' },
  source: 'edit',
  createdById: 'user-abc-1234-5678',
  createdByType: 'user' as const,
  createdAt: '2026-01-02T00:00:00Z',
  isPublished: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSite.mockResolvedValue({
    id: 'site-123',
    name: 'Test Site',
    pantheonSiteId: 'pan-123',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  mockGetBranch.mockResolvedValue({
    id: 'branch-456',
    siteId: 'site-123',
    name: 'main',
    isMain: true,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  mockGetDocument.mockResolvedValue({
    id: 'doc-789',
    siteId: 'site-123',
    path: 'pages/about',
    createdAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
  });
});

describe('DocumentPage - Published badge in version history', () => {
  it('should show "Published" badge on versions where isPublished is true', async () => {
    mockGetLatestDocumentVersion.mockResolvedValue(unpublishedVersion);
    mockListDocumentVersions.mockResolvedValue([unpublishedVersion, publishedVersion]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    // The version history table should show "Published" badge
    const publishedBadges = screen.getAllByText('Published');
    expect(publishedBadges).toHaveLength(1);
  });

  it('should NOT show "Published" badge on versions where isPublished is false', async () => {
    mockGetLatestDocumentVersion.mockResolvedValue(unpublishedVersion);
    mockListDocumentVersions.mockResolvedValue([unpublishedVersion]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    expect(screen.queryByText('Published')).not.toBeInTheDocument();
  });

  it('should NOT show "Published" badge on versions where isPublished is undefined', async () => {
    const versionWithoutField = {
      id: 'ver-no-field',
      documentId: 'doc-789',
      branchId: 'branch-456',
      versionNumber: 1,
      snapshot: { title: 'About' },
      source: 'edit',
      createdById: 'user-abc-1234-5678',
      createdByType: 'user' as const,
      createdAt: '2026-01-01T00:00:00Z',
      // isPublished intentionally omitted
    };

    mockGetLatestDocumentVersion.mockResolvedValue(versionWithoutField);
    mockListDocumentVersions.mockResolvedValue([versionWithoutField]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    expect(screen.queryByText('Published')).not.toBeInTheDocument();
  });

  it('should show multiple "Published" badges when multiple versions are published', async () => {
    const anotherPublished = {
      ...publishedVersion,
      id: 'ver-3',
      versionNumber: 3,
      isPublished: true,
    };

    mockGetLatestDocumentVersion.mockResolvedValue(anotherPublished);
    mockListDocumentVersions.mockResolvedValue([
      anotherPublished,
      unpublishedVersion,
      publishedVersion,
    ]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    const publishedBadges = screen.getAllByText('Published');
    expect(publishedBadges).toHaveLength(2);
  });
});

describe('DocumentPage - Unpublished indicator', () => {
  it('should show "Unpublished" indicator when no versions have isPublished', async () => {
    const noPublished1 = { ...unpublishedVersion, id: 'ver-a', versionNumber: 1 };
    const noPublished2 = { ...unpublishedVersion, id: 'ver-b', versionNumber: 2 };

    mockGetLatestDocumentVersion.mockResolvedValue(noPublished2);
    mockListDocumentVersions.mockResolvedValue([noPublished2, noPublished1]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    // Should show "Unpublished" indicator in the document header
    expect(screen.getByText('Unpublished')).toBeInTheDocument();
  });

  it('should NOT show "Unpublished" indicator when at least one version is published', async () => {
    mockGetLatestDocumentVersion.mockResolvedValue(unpublishedVersion);
    mockListDocumentVersions.mockResolvedValue([unpublishedVersion, publishedVersion]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    expect(screen.queryByText('Unpublished')).not.toBeInTheDocument();
  });

  it('should NOT show "Unpublished" indicator when versions have not loaded yet', async () => {
    mockGetLatestDocumentVersion.mockResolvedValue(unpublishedVersion);
    // Versions loading is in-flight (never resolves within test)
    mockListDocumentVersions.mockReturnValue(new Promise(() => {}));

    render(<DocumentPage />);

    // Wait for document to appear
    await waitFor(() => {
      expect(screen.getAllByText('pages/about').length).toBeGreaterThan(0);
    });

    // Should not show "Unpublished" while loading
    expect(screen.queryByText('Unpublished')).not.toBeInTheDocument();
  });
});
