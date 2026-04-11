/**
 * SiteDetailPage Settings Section Tests (TDD - Red Phase)
 *
 * Tests for the Settings section on the SiteDetailPage,
 * including CacheSettings integration.
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

vi.mock('../../api/site-tokens', () => ({
  listSiteTokens: vi.fn().mockResolvedValue([]),
  generateSiteToken: vi.fn().mockResolvedValue(undefined),
  revokeSiteToken: vi.fn().mockResolvedValue(undefined),
}));

// Mock site-settings with hoisted mocks
const mockGetSiteSettings = vi.fn().mockResolvedValue({});
const mockUpdateSiteSettings = vi.fn();
vi.mock('../../api/site-settings', () => ({
  getSiteSettings: (...args: unknown[]) => mockGetSiteSettings(...args),
  updateSiteSettings: (...args: unknown[]) => mockUpdateSiteSettings(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSiteSettings.mockResolvedValue({});
  mockUpdateSiteSettings.mockResolvedValue({});
});

describe('Settings Section', () => {
  it('should render the Settings section header', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('section-title-settings')).toBeInTheDocument();
    });
    expect(screen.getByTestId('section-title-settings')).toHaveTextContent('Settings');
  });

  it('should fetch site settings on page load', async () => {
    render(<SiteDetailPage />);

    await waitFor(() => {
      expect(mockGetSiteSettings).toHaveBeenCalledWith('site-123');
    });
  });

  it('should pass fetched settings to the CacheSettings component', async () => {
    const settingsData = { cacheTtlMain: 120, cacheTtlBranch: 10 };
    mockGetSiteSettings.mockResolvedValue(settingsData);

    render(<SiteDetailPage />);

    await waitFor(() => {
      const mainInput = screen.getByTestId('cache-ttl-main-input') as HTMLInputElement;
      expect(mainInput.value).toBe('120');
    });

    const branchInput = screen.getByTestId('cache-ttl-branch-input') as HTMLInputElement;
    expect(branchInput.value).toBe('10');
  });

  it('should update settings via API when CacheSettings saves', async () => {
    const user = userEvent.setup();
    mockGetSiteSettings.mockResolvedValue({});
    mockUpdateSiteSettings.mockResolvedValue({ cacheTtlMain: 300, cacheTtlBranch: 15 });

    render(<SiteDetailPage />);

    // Wait for the settings section to render
    await waitFor(() => {
      expect(screen.getByTestId('cache-ttl-main-input')).toBeInTheDocument();
    });

    const mainInput = screen.getByTestId('cache-ttl-main-input');
    const branchInput = screen.getByTestId('cache-ttl-branch-input');

    await user.type(mainInput, '300');
    await user.type(branchInput, '15');

    const saveButton = screen.getByTestId('cache-settings-save-btn');
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledWith('site-123', expect.objectContaining({
        cacheTtlMain: 300,
        cacheTtlBranch: 15,
      }));
    });
  });
});
