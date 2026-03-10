/**
 * DocumentPage Publish Provenance Tests (TDD - Red Phase)
 *
 * Tests for publish provenance display in version history:
 * - "Published from {branchName}" badge when version has sourceBranchName
 * - "Published to main" badge when version has publishedToVersionId
 * - No provenance badges when provenance fields are absent
 * - Source column shows "publish" with appropriate styling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

// Mock @pantheon-systems/design-toolkit-react
vi.mock('@pantheon-systems/design-toolkit-react', () => ({
  Button: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void; [key: string]: unknown }) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
  RouterLinkButton: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Alert: ({ children, type, ...props }: { children: React.ReactNode; type?: string; [key: string]: unknown }) => (
    <div data-alert-type={type} {...props}>{children}</div>
  ),
  Tag: ({ children, type, ...props }: { children: React.ReactNode; type?: string; [key: string]: unknown }) => (
    <span data-tag-type={type} {...props}>{children}</span>
  ),
  Tabs: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  TabList: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Tab: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  TabPanels: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  TabPanel: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

// Mock API modules
const mockGetSite = vi.fn();
const mockGetBranch = vi.fn();
const mockGetDocument = vi.fn();
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

function createMockVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver-1',
    documentId: 'doc-789',
    branchId: 'branch-456',
    versionNumber: 1,
    snapshot: { title: 'About' },
    source: 'edit',
    createdById: 'user-abc-1234-5678',
    createdByType: 'user' as const,
    createdAt: '2026-01-01T00:00:00Z',
    isPublished: false,
    ...overrides,
  };
}

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

describe('DocumentPage - Publish provenance in version history', () => {
  it('should display "Published from {branchName}" badge when version has sourceBranchName', async () => {
    const publishedFromBranch = createMockVersion({
      id: 'ver-publish-from',
      versionNumber: 2,
      source: 'publish',
      sourceBranchName: 'feature/redesign',
      isPublished: true,
    });
    const regularVersion = createMockVersion({
      id: 'ver-regular',
      versionNumber: 1,
    });

    mockGetLatestDocumentVersion.mockResolvedValue(publishedFromBranch);
    mockListDocumentVersions.mockResolvedValue([publishedFromBranch, regularVersion]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    // Should show a provenance badge indicating the source branch
    const provenanceBadge = screen.getByText('from feature/redesign');
    expect(provenanceBadge).toBeInTheDocument();
    expect(provenanceBadge.closest('.provenance-badge')).toBeInTheDocument();
  });

  it('should display "Published to main" badge when version has publishedToVersionId', async () => {
    const publishedToMain = createMockVersion({
      id: 'ver-publish-to',
      versionNumber: 1,
      source: 'edit',
      publishedToVersionId: 'ver-on-main-uuid',
    });

    mockGetLatestDocumentVersion.mockResolvedValue(publishedToMain);
    mockListDocumentVersions.mockResolvedValue([publishedToMain]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    // Should show a badge indicating this version was published to main
    const publishedToMainBadge = screen.getByText('Published to main');
    expect(publishedToMainBadge).toBeInTheDocument();
    expect(publishedToMainBadge.closest('.published-to-main-badge')).toBeInTheDocument();
  });

  it('should NOT display provenance badges when fields are absent', async () => {
    const regularEdit = createMockVersion({
      id: 'ver-plain',
      versionNumber: 1,
      source: 'edit',
      // No sourceBranchName, no publishedToVersionId
    });

    mockGetLatestDocumentVersion.mockResolvedValue(regularEdit);
    mockListDocumentVersions.mockResolvedValue([regularEdit]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    // Should NOT show any provenance-related badges
    expect(screen.queryByText(/from /)).not.toBeInTheDocument();
    expect(screen.queryByText('Published to main')).not.toBeInTheDocument();

    // Verify no provenance badge elements exist
    const versionsTable = screen.getByTestId('versions-table');
    expect(within(versionsTable).queryByText(/from /)).not.toBeInTheDocument();
    expect(within(versionsTable).queryByText('Published to main')).not.toBeInTheDocument();
  });

  it('should display source as "publish" in source column', async () => {
    const publishVersion = createMockVersion({
      id: 'ver-publish-source',
      versionNumber: 1,
      source: 'publish',
      sourceBranchName: 'feature/redesign',
      isPublished: true,
    });

    mockGetLatestDocumentVersion.mockResolvedValue(publishVersion);
    mockListDocumentVersions.mockResolvedValue([publishVersion]);

    render(<DocumentPage />);

    await waitFor(() => {
      expect(screen.getByTestId('versions-table')).toBeInTheDocument();
    });

    // The source column should display "publish" as the source type
    const versionsTable = screen.getByTestId('versions-table');
    const publishSourceBadge = within(versionsTable).getByText('publish');
    expect(publishSourceBadge).toBeInTheDocument();
  });
});
