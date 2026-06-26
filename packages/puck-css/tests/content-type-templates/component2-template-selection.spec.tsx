/**
 * Component 2 Tests: Template Selection in Document Creation
 *
 * Tests that:
 * 1. PageNavigator shows template selector when templates are provided
 * 2. PageNavigator skips template step when no templates available
 * 3. Template selection flows through to document creation
 * 4. useDocuments.create accepts template options parameter
 * 5. P1PuckProvider.stableCreateDocument scaffolds from template
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch, Document } from '@pantheon-systems/css-client';
import type { Template } from '../../src/features/content-type-templates/types.js';

// =============================================================================
// Mock useRealtime hook
// =============================================================================

vi.mock('../../src/editor/useRealtime.js', () => ({
  useRealtime: () => ({
    connected: false,
    applyLocalChange: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(null),
    error: null,
    sendFocusRegions: vi.fn().mockReturnValue(false),
    sendHeartbeat: vi.fn(),
    presenceViaWebSocket: false,
    connectedDocumentPath: null,
  }),
}));

// =============================================================================
// Import AFTER the mock
// =============================================================================

const { PageNavigator } = await import('../../src/pds/components/PageNavigator.js');
const { useDocuments } = await import('../../src/editor/useDocuments.js');
const { P1PuckProvider } = await import('../../src/editor/P1PuckProvider.js');
const { useP1Puck } = await import('../../src/core/P1PuckContext.js');

// =============================================================================
// Mock Data
// =============================================================================

const mockBranch: Branch = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockTemplate: Template = {
  id: 'template-1',
  name: 'blog-post',
  label: 'Blog Post',
  description: 'A template for blog posts',
  defaultUrlPattern: '/blog/{slug}',
  version: 1,
  components: [
    { type: 'Hero', pinned: true, defaultProps: { title: 'Default Hero' } },
    { type: 'RichText', pinned: false, defaultProps: {} },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockTemplates: Template[] = [
  mockTemplate,
  {
    id: 'template-2',
    name: 'landing-page',
    label: 'Landing Page',
    version: 1,
    components: [
      { type: 'Hero', pinned: true, defaultProps: {} },
      { type: 'Features', pinned: true, defaultProps: {} },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

function createMockClient(): P1Client {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([mockBranch]),
      get: vi.fn().mockResolvedValue(mockBranch),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getByPath: vi.fn(),
      create: vi.fn().mockResolvedValue({
        id: 'doc-new',
        siteId: 'site-1',
        path: '/new-page',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      getLatest: vi.fn().mockResolvedValue({
        id: 'v1',
        versionNumber: 1,
        snapshot: { content: [], root: { props: {} } },
        createdAt: '2026-01-01T00:00:00Z',
      }),
      create: vi.fn().mockResolvedValue({
        id: 'v1',
        versionNumber: 1,
        snapshot: { content: [], root: { props: {} } },
        createdAt: '2026-01-01T00:00:00Z',
      }),
    },
    checkpoints: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
    },
    presence: {
      getSitePresence: vi.fn(),
      getBranchPresence: vi.fn(),
      getAgentPresence: vi.fn(),
    },
    agentRegistry: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateStatus: vi.fn(),
      delete: vi.fn(),
    },
    agentEdit: {
      canEdit: vi.fn(),
      startEdit: vi.fn(),
      completeEdit: vi.fn(),
      abortEdit: vi.fn(),
    },
    templates: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as P1Client;
}

// =============================================================================
// PageNavigator Template Selection Tests
// =============================================================================

describe('PageNavigator template selection', () => {
  it('shows template selector when templates are provided and user clicks "+ New page"', async () => {
    const onCreateDocument = vi.fn();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PageNavigator
        documents={[]}
        currentDocument={null}
        onSelect={onSelect}
        onClose={onClose}
        open={true}
        templates={mockTemplates}
        onCreateDocument={onCreateDocument}
      />
    );

    // Click "+ New page" button
    const newPageButton = screen.getByTestId('page-navigator-new');
    fireEvent.click(newPageButton);

    // Should show template selector
    await waitFor(() => {
      expect(screen.getByTestId('template-selector')).toBeInTheDocument();
    });

    // Should show templates
    expect(screen.getByText('Blog Post')).toBeInTheDocument();
    expect(screen.getByText('Landing Page')).toBeInTheDocument();
    expect(screen.getByText('Blank Page')).toBeInTheDocument();
  });

  it('skips template step when no templates are provided', async () => {
    const onCreateDocument = vi.fn();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PageNavigator
        documents={[]}
        currentDocument={null}
        onSelect={onSelect}
        onClose={onClose}
        open={true}
        templates={[]}
        onCreateDocument={onCreateDocument}
      />
    );

    // Click "+ New page" button
    const newPageButton = screen.getByTestId('page-navigator-new');
    fireEvent.click(newPageButton);

    // Should skip template selector and go straight to path input
    await waitFor(() => {
      expect(screen.getByTestId('page-navigator-create-form')).toBeInTheDocument();
    });

    // Should NOT show template selector
    expect(screen.queryByTestId('template-selector')).not.toBeInTheDocument();
  });

  it('skips template step when templates prop is undefined', async () => {
    const onCreateDocument = vi.fn();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PageNavigator
        documents={[]}
        currentDocument={null}
        onSelect={onSelect}
        onClose={onClose}
        open={true}
        onCreateDocument={onCreateDocument}
      />
    );

    // Click "+ New page" button
    const newPageButton = screen.getByTestId('page-navigator-new');
    fireEvent.click(newPageButton);

    // Should skip template selector and go straight to path input
    await waitFor(() => {
      expect(screen.getByTestId('page-navigator-create-form')).toBeInTheDocument();
    });

    // Should NOT show template selector
    expect(screen.queryByTestId('template-selector')).not.toBeInTheDocument();
  });

  it('selecting "Blank Page" sets template to null', async () => {
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PageNavigator
        documents={[]}
        currentDocument={null}
        onSelect={onSelect}
        onClose={onClose}
        open={true}
        templates={mockTemplates}
        onCreateDocument={onCreateDocument}
      />
    );

    // Click "+ New page" button
    const newPageButton = screen.getByTestId('page-navigator-new');
    fireEvent.click(newPageButton);

    // Wait for template selector
    await waitFor(() => {
      expect(screen.getByTestId('template-selector')).toBeInTheDocument();
    });

    // Select "Blank Page"
    const blankPageOption = screen.getByText('Blank Page');
    fireEvent.click(blankPageOption);

    // Should proceed to path input
    await waitFor(() => {
      expect(screen.getByTestId('page-navigator-create-form')).toBeInTheDocument();
    });

    // Enter path and submit
    const pathInput = screen.getByTestId('page-navigator-create-input');
    fireEvent.change(pathInput, { target: { value: '/new-page' } });

    const form = screen.getByTestId('page-navigator-create-form');
    fireEvent.submit(form);

    // onCreateDocument should be called with null template (leading slash stripped)
    await waitFor(() => {
      expect(onCreateDocument).toHaveBeenCalledWith('new-page', null);
    });
  });

  it('selecting a template sets the selected template', async () => {
    const onCreateDocument = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PageNavigator
        documents={[]}
        currentDocument={null}
        onSelect={onSelect}
        onClose={onClose}
        open={true}
        templates={mockTemplates}
        onCreateDocument={onCreateDocument}
      />
    );

    // Click "+ New page" button
    const newPageButton = screen.getByTestId('page-navigator-new');
    fireEvent.click(newPageButton);

    // Wait for template selector
    await waitFor(() => {
      expect(screen.getByTestId('template-selector')).toBeInTheDocument();
    });

    // Select "Blog Post" template
    const blogPostOption = screen.getByText('Blog Post');
    fireEvent.click(blogPostOption);

    // Should proceed to path input
    await waitFor(() => {
      expect(screen.getByTestId('page-navigator-create-form')).toBeInTheDocument();
    });

    // Enter path and submit
    const pathInput = screen.getByTestId('page-navigator-create-input');
    fireEvent.change(pathInput, { target: { value: '/blog/my-post' } });

    const form = screen.getByTestId('page-navigator-create-form');
    fireEvent.submit(form);

    // onCreateDocument should be called with the selected template (leading slash stripped)
    await waitFor(() => {
      expect(onCreateDocument).toHaveBeenCalledWith('blog/my-post', mockTemplate);
    });
  });

  it('shows loading state while templates are loading', async () => {
    const onCreateDocument = vi.fn();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PageNavigator
        documents={[]}
        currentDocument={null}
        onSelect={onSelect}
        onClose={onClose}
        open={true}
        templates={mockTemplates}
        templatesLoading={true}
        onCreateDocument={onCreateDocument}
      />
    );

    // Click "+ New page" button
    const newPageButton = screen.getByTestId('page-navigator-new');
    fireEvent.click(newPageButton);

    // Should show loading indicator
    await waitFor(() => {
      expect(screen.getByTestId('template-selector-loading')).toBeInTheDocument();
    });
  });

  it('cancel resets template selection state', async () => {
    const onCreateDocument = vi.fn();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PageNavigator
        documents={[]}
        currentDocument={null}
        onSelect={onSelect}
        onClose={onClose}
        open={true}
        templates={mockTemplates}
        onCreateDocument={onCreateDocument}
      />
    );

    // Click "+ New page" button
    const newPageButton = screen.getByTestId('page-navigator-new');
    fireEvent.click(newPageButton);

    // Wait for template selector
    await waitFor(() => {
      expect(screen.getByTestId('template-selector')).toBeInTheDocument();
    });

    // Select a template
    const blogPostOption = screen.getByText('Blog Post');
    fireEvent.click(blogPostOption);

    // Should proceed to path input
    await waitFor(() => {
      expect(screen.getByTestId('page-navigator-create-form')).toBeInTheDocument();
    });

    // Click cancel
    const cancelButton = screen.getByTestId('page-navigator-create-cancel');
    fireEvent.click(cancelButton);

    // Should go back to main view (+ New page button visible)
    await waitFor(() => {
      expect(screen.getByTestId('page-navigator-new')).toBeInTheDocument();
    });

    // Click "+ New page" again
    fireEvent.click(screen.getByTestId('page-navigator-new'));

    // Should show template selector again (state was reset)
    await waitFor(() => {
      expect(screen.getByTestId('template-selector')).toBeInTheDocument();
    });
  });
});

// =============================================================================
// useDocuments.create with template options
// =============================================================================

describe('useDocuments.create with template binding', () => {
  let client: P1Client;

  beforeEach(() => {
    client = createMockClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls client.documents.create with template_id and template_version when options provided', async () => {
    const { result } = renderHook(() =>
      useDocuments({ client, siteId: 'site-1', branchId: 'branch-1' })
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Create document with template options
    await act(async () => {
      await result.current.create('/test-page', undefined, {
        templateId: 'template-1',
        templateVersion: 1,
      });
    });

    // Verify client.documents.create was called with template fields
    expect(client.documents.create).toHaveBeenCalledWith({
      siteId: 'site-1',
      branchId: 'branch-1',
      path: '/test-page',
      templateId: 'template-1',
      templateVersion: 1,
    });
  });

  it('calls client.documents.create without template fields when no options provided', async () => {
    const { result } = renderHook(() =>
      useDocuments({ client, siteId: 'site-1', branchId: 'branch-1' })
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Create document without template options
    await act(async () => {
      await result.current.create('/test-page');
    });

    // Verify client.documents.create was called without template fields
    expect(client.documents.create).toHaveBeenCalledWith({
      siteId: 'site-1',
      branchId: 'branch-1',
      path: '/test-page',
    });
  });

  it('calls client.documents.create without template fields when options is empty object', async () => {
    const { result } = renderHook(() =>
      useDocuments({ client, siteId: 'site-1', branchId: 'branch-1' })
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Create document with empty options
    await act(async () => {
      await result.current.create('/test-page', undefined, {});
    });

    // Verify client.documents.create was called without template fields
    expect(client.documents.create).toHaveBeenCalledWith({
      siteId: 'site-1',
      branchId: 'branch-1',
      path: '/test-page',
    });
  });
});

// =============================================================================
// P1PuckProvider.stableCreateDocument with template scaffolding
// =============================================================================

describe('P1PuckProvider.createDocument with template', () => {
  let client: P1Client;

  beforeEach(() => {
    client = createMockClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses scaffoldFromTemplate for initial data when template is provided', async () => {
    const mockDoc = {
      id: 'doc-new',
      siteId: 'site-1',
      path: '/test-page',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      templateId: 'template-1',
      templateVersion: 1,
    };

    (client.documents as any).create = vi.fn().mockResolvedValue(mockDoc);
    (client.templates as any).get = vi.fn().mockResolvedValue(mockTemplate);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });

    // Wait for provider to initialize
    await waitFor(() => {
      expect(result.current.createDocument).toBeDefined();
    });

    // Create document with template
    await act(async () => {
      await result.current.createDocument('/test-page', mockTemplate);
    });

    // Verify versions.create was called with scaffolded data
    expect(client.versions.create).toHaveBeenCalled();
    const createCall = (client.versions.create as any).mock.calls[0];
    const snapshot = createCall[1].snapshot;

    // Should have content from template components
    expect(snapshot.content).toBeDefined();
    expect(snapshot.content.length).toBe(2);
    expect(snapshot.content[0].type).toBe('Hero');
    expect(snapshot.content[1].type).toBe('RichText');
  });

  it('creates blank document when no template is provided', async () => {
    const mockDoc = {
      id: 'doc-new',
      siteId: 'site-1',
      path: '/test-page',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    (client.documents as any).create = vi.fn().mockResolvedValue(mockDoc);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });

    // Wait for provider to initialize
    await waitFor(() => {
      expect(result.current.createDocument).toBeDefined();
    });

    // Create document without template (null)
    await act(async () => {
      await result.current.createDocument('/test-page', null);
    });

    // Verify versions.create was called with empty content
    expect(client.versions.create).toHaveBeenCalled();
    const createCall = (client.versions.create as any).mock.calls[0];
    const snapshot = createCall[1].snapshot;
    expect(snapshot.content).toEqual([]);
    expect(snapshot.root).toEqual({ props: {} });
  });

  it('creates blank document when template is undefined', async () => {
    const mockDoc = {
      id: 'doc-new',
      siteId: 'site-1',
      path: '/test-page',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    (client.documents as any).create = vi.fn().mockResolvedValue(mockDoc);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(P1PuckProvider, {
        client,
        siteId: 'site-1',
        branchId: 'branch-1',
        userId: 'user-789',
      }, children);

    const { result } = renderHook(() => useP1Puck(), { wrapper });

    // Wait for provider to initialize
    await waitFor(() => {
      expect(result.current.createDocument).toBeDefined();
    });

    // Create document without template (omitted)
    await act(async () => {
      await result.current.createDocument('/test-page');
    });

    // Verify versions.create was called with empty content
    expect(client.versions.create).toHaveBeenCalled();
    const createCall = (client.versions.create as any).mock.calls[0];
    const snapshot = createCall[1].snapshot;
    expect(snapshot.content).toEqual([]);
    expect(snapshot.root).toEqual({ props: {} });
  });
});
