import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

let mockCcrContext: Record<string, unknown> = {};
let mockItemSelector: unknown = null;

vi.mock('../core/P1PuckContext', () => ({
  useP1PuckOptional: () => mockCcrContext,
}));

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => {
    return (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        appState: {
          ui: {
            itemSelector: mockItemSelector,
            rightSideBarVisible: true,
          },
          data: { content: [] },
        },
        selectedItem: mockItemSelector ? { type: 'HeadingBlock' } : null,
        dispatch: vi.fn(),
        config: { components: {} },
      });
  },
}));

vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  IconButton: () => null,
}));

vi.mock('../editor/components/P1TemplateFields', () => ({
  P1TemplateFields: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../editor/utils/templatePath', () => ({
  templateFromRegistryPath: () => null,
}));

vi.mock('../versioning/components/ReadOnlyFieldsGuard', () => ({
  ReadOnlyFieldsGuard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../versioning/components/VersionReadOnlyBanner', () => ({
  VersionReadOnlyBanner: () => null,
}));

vi.mock('../editor/components/InspectorTabHeader', () => ({
  InspectorTabHeader: () => <div data-testid="tab-header" />,
}));

import { P1InspectorFields } from '../editor/components/P1InspectorFields.js';

afterEach(() => {
  cleanup();
  mockCcrContext = {};
  mockItemSelector = null;
});

describe('P1InspectorFields template badge', () => {
  it('renders template name when page has a bound template', () => {
    mockCcrContext = {
      currentDocument: { path: '/my-page' },
      currentTemplate: {
        id: 'tmpl-001',
        name: 'events',
        version: 1,
        updatedAt: '2026-01-01',
        root: { props: { _template: { label: 'Events' } } },
        content: [],
        zones: {},
      },
    };
    mockItemSelector = null;

    render(
      <P1InspectorFields>
        <div>fields</div>
      </P1InspectorFields>,
    );

    expect(screen.getByText('Template')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
  });

  it('does not render template badge when page has no template', () => {
    mockCcrContext = {
      currentDocument: { path: '/my-page' },
      currentTemplate: null,
    };
    mockItemSelector = null;

    render(
      <P1InspectorFields>
        <div>fields</div>
      </P1InspectorFields>,
    );

    expect(screen.queryByText('Template')).not.toBeInTheDocument();
  });

  it('does not render template badge when a block is selected', () => {
    mockCcrContext = {
      currentDocument: { path: '/my-page' },
      currentTemplate: {
        id: 'tmpl-001',
        name: 'events',
        version: 1,
        updatedAt: '2026-01-01',
        root: { props: { _template: { label: 'Events' } } },
        content: [],
        zones: {},
      },
    };
    mockItemSelector = { zone: 'default-zone', index: 0 };

    render(
      <P1InspectorFields>
        <div>fields</div>
      </P1InspectorFields>,
    );

    expect(screen.queryByText('Template')).not.toBeInTheDocument();
  });
});
