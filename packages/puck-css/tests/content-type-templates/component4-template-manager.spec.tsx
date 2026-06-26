/**
 * Component 4 Tests: Template Management UI
 *
 * Tests for:
 * 1. dataToTemplate conversion utilities
 * 2. TemplateManagerOverlay component
 * 3. TemplatePinPanel component
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch } from '@pantheon-systems/css-client';
import type { Template } from '../../src/features/content-type-templates/types.js';
import { dataToCreateParams, dataToUpdateParams } from '../../src/features/content-type-templates/ui/dataToTemplate.js';

// =============================================================================
// dataToTemplate conversion tests
// =============================================================================

describe('dataToCreateParams', () => {
  it('converts Puck data and pin map to CreateTemplateParams', () => {
    const data = {
      content: [
        { type: 'Hero', props: { id: 'comp-1', title: 'Hello' } },
        { type: 'RichText', props: { id: 'comp-2', body: 'World' } },
      ],
      root: { props: {} },
    };
    const pinMap = new Map([
      ['comp-1', true],
      ['comp-2', false],
    ]);
    const metadata = {
      name: 'blog-post',
      label: 'Blog Post',
      description: 'A blog post template',
    };

    const result = dataToCreateParams(data, pinMap, metadata);

    expect(result.name).toBe('blog-post');
    expect(result.label).toBe('Blog Post');
    expect(result.description).toBe('A blog post template');
    expect(result.components).toHaveLength(2);
    expect(result.components[0]).toEqual({
      type: 'Hero',
      pinned: true,
      defaultProps: { title: 'Hello' },
    });
    expect(result.components[1]).toEqual({
      type: 'RichText',
      pinned: false,
      defaultProps: { body: 'World' },
    });
  });

  it('strips component id from defaultProps', () => {
    const data = {
      content: [
        { type: 'Hero', props: { id: 'comp-1', title: 'Test' } },
      ],
      root: { props: {} },
    };
    const pinMap = new Map<string, boolean>();
    const metadata = { name: 'test', label: 'Test' };

    const result = dataToCreateParams(data, pinMap, metadata);
    expect(result.components[0].defaultProps).not.toHaveProperty('id');
    expect(result.components[0].defaultProps).toEqual({ title: 'Test' });
  });

  it('defaults pinned to false for components not in pin map', () => {
    const data = {
      content: [
        { type: 'Hero', props: { id: 'comp-1' } },
      ],
      root: { props: {} },
    };
    const pinMap = new Map<string, boolean>();
    const metadata = { name: 'test', label: 'Test' };

    const result = dataToCreateParams(data, pinMap, metadata);
    expect(result.components[0].pinned).toBe(false);
  });
});

describe('dataToUpdateParams', () => {
  it('converts Puck data and pin map to UpdateTemplateParams', () => {
    const data = {
      content: [
        { type: 'Hero', props: { id: 'comp-1', title: 'Updated' } },
      ],
      root: { props: {} },
    };
    const pinMap = new Map([['comp-1', true]]);
    const metadata = { label: 'Updated Label' };

    const result = dataToUpdateParams(data, pinMap, metadata);

    expect(result.label).toBe('Updated Label');
    expect(result.components).toHaveLength(1);
    expect(result.components![0]).toEqual({
      type: 'Hero',
      pinned: true,
      defaultProps: { title: 'Updated' },
    });
  });
});

// =============================================================================
// TemplatePinPanel tests
// =============================================================================

describe('TemplatePinPanel', () => {
  // Lazy import to avoid top-level module resolution issues
  let TemplatePinPanel: any;

  beforeAll(async () => {
    const mod = await import('../../src/features/content-type-templates/ui/TemplatePinPanel.js');
    TemplatePinPanel = mod.TemplatePinPanel;
  });

  it('renders a list of components with pin toggles', () => {
    const components = [
      { id: 'comp-1', type: 'Hero' },
      { id: 'comp-2', type: 'RichText' },
    ];
    const pinMap = new Map([
      ['comp-1', true],
      ['comp-2', false],
    ]);
    const onTogglePin = vi.fn();

    render(
      <TemplatePinPanel
        components={components}
        pinMap={pinMap}
        onTogglePin={onTogglePin}
      />
    );

    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(screen.getByText('RichText')).toBeInTheDocument();
  });

  it('calls onTogglePin when checkbox is toggled', () => {
    const components = [
      { id: 'comp-1', type: 'Hero' },
    ];
    const pinMap = new Map([['comp-1', false]]);
    const onTogglePin = vi.fn();

    render(
      <TemplatePinPanel
        components={components}
        pinMap={pinMap}
        onTogglePin={onTogglePin}
      />
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(onTogglePin).toHaveBeenCalledWith('comp-1', true);
  });

  it('shows pinned state correctly', () => {
    const components = [
      { id: 'comp-1', type: 'Hero' },
    ];
    const pinMap = new Map([['comp-1', true]]);
    const onTogglePin = vi.fn();

    render(
      <TemplatePinPanel
        components={components}
        pinMap={pinMap}
        onTogglePin={onTogglePin}
      />
    );

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('shows empty state when no components', () => {
    const onTogglePin = vi.fn();

    render(
      <TemplatePinPanel
        components={[]}
        pinMap={new Map()}
        onTogglePin={onTogglePin}
      />
    );

    expect(screen.getByText(/no components/i)).toBeInTheDocument();
  });
});

// =============================================================================
// TemplateManagerOverlay tests
// =============================================================================

describe('TemplateManagerOverlay', () => {
  let TemplateManagerOverlay: any;

  const mockTemplates: Template[] = [
    {
      id: 'template-1',
      name: 'blog-post',
      label: 'Blog Post',
      version: 1,
      components: [
        { type: 'Hero', pinned: true, defaultProps: {} },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'template-2',
      name: 'landing-page',
      label: 'Landing Page',
      version: 1,
      components: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  function createMockClient(templates: Template[] = mockTemplates): P1Client {
    return {
      branches: { list: vi.fn().mockResolvedValue([]) },
      documents: { list: vi.fn().mockResolvedValue([]) },
      versions: { list: vi.fn().mockResolvedValue([]) },
      checkpoints: { list: vi.fn().mockResolvedValue([]) },
      presence: {},
      agentRegistry: {},
      agentEdit: {},
      templates: {
        list: vi.fn().mockResolvedValue(templates),
        get: vi.fn().mockImplementation((_, id: string) =>
          Promise.resolve(templates.find((t) => t.id === id) ?? null)),
        create: vi.fn().mockResolvedValue({ id: 'new-template', name: 'new', label: 'New', version: 1, components: [] }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      withPrincipal: vi.fn().mockReturnThis(),
    } as unknown as P1Client;
  }

  beforeAll(async () => {
    const mod = await import('../../src/features/content-type-templates/ui/TemplateManagerOverlay.js');
    TemplateManagerOverlay = mod.TemplateManagerOverlay;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders template list', async () => {
    const client = createMockClient();
    const onClose = vi.fn();

    render(
      <TemplateManagerOverlay
        client={client}
        siteId="site-1"
        branchId="branch-1"
        puckConfig={{ components: {} }}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Blog Post')).toBeInTheDocument();
      expect(screen.getByText('Landing Page')).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const client = createMockClient();
    const onClose = vi.fn();

    render(
      <TemplateManagerOverlay
        client={client}
        siteId="site-1"
        branchId="branch-1"
        puckConfig={{ components: {} }}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByLabelText('Close template manager');
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('shows create template button', async () => {
    const client = createMockClient();
    const onClose = vi.fn();

    render(
      <TemplateManagerOverlay
        client={client}
        siteId="site-1"
        branchId="branch-1"
        puckConfig={{ components: {} }}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/new template/i)).toBeInTheDocument();
    });
  });

  it('deletes template with confirmation', async () => {
    const client = createMockClient();
    const onClose = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <TemplateManagerOverlay
        client={client}
        siteId="site-1"
        branchId="branch-1"
        puckConfig={{ components: {} }}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Blog Post')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByLabelText(/delete/i);
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(client.templates.delete).toHaveBeenCalledWith('site-1', 'branch-1', 'template-1');
  });
});
