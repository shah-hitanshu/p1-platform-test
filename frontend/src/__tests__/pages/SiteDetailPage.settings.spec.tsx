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
