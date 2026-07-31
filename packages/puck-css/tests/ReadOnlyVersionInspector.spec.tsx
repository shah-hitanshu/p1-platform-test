/**
 * PCC-3422: Read-Only Version Preview Inspector Tests
 *
 * Covers:
 *   - ReadOnlyFieldsGuard
 *   - VersionReadOnlyBanner
 *   - InspectorTabHeader
 *   - P1InspectorFields (orchestrator)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';

// =============================================================================
// ReadOnlyFieldsGuard
// =============================================================================

import { ReadOnlyFieldsGuard } from '../src/versioning/components/ReadOnlyFieldsGuard.js';

describe('ReadOnlyFieldsGuard', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('renders children unwrapped when isReadOnly=false', () => {
    const { container } = render(
      <ReadOnlyFieldsGuard isReadOnly={false}>
        <span data-testid="child">content</span>
      </ReadOnlyFieldsGuard>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(container.querySelector('[inert]')).toBeNull();
    expect(container.querySelector('.p1-readonly-fields-guard')).toBeNull();
  });

  it('wraps children in a div with inert attribute when isReadOnly=true', () => {
    const { container } = render(
      <ReadOnlyFieldsGuard isReadOnly={true}>
        <span data-testid="child">content</span>
      </ReadOnlyFieldsGuard>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    const guard = container.querySelector('[inert]');
    expect(guard).not.toBeNull();
  });

  it('applies p1-readonly-fields-guard class when isReadOnly=true', () => {
    const { container } = render(
      <ReadOnlyFieldsGuard isReadOnly={true}>
        <span>content</span>
      </ReadOnlyFieldsGuard>
    );
    expect(container.querySelector('.p1-readonly-fields-guard')).not.toBeNull();
  });
});

// =============================================================================
// VersionReadOnlyBanner
// =============================================================================

import { VersionReadOnlyBanner } from '../src/versioning/components/VersionReadOnlyBanner.js';

describe('VersionReadOnlyBanner', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('renders the version number and read-only message', () => {
    const { container } = render(<VersionReadOnlyBanner versionNumber={5} />);
    expect(container.textContent).toMatch(/Viewing v5/);
    expect(container.textContent).toMatch(/Fields are read-only/);
  });

  it('contains no em-dashes in rendered text', () => {
    const { container } = render(<VersionReadOnlyBanner versionNumber={3} />);
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).not.toContain('—');
  });

  it('renders with p1-version-readonly-banner class', () => {
    const { container } = render(<VersionReadOnlyBanner versionNumber={1} />);
    expect(container.querySelector('.p1-version-readonly-banner')).not.toBeNull();
  });
});

// =============================================================================
// InspectorTabHeader
// =============================================================================

import { InspectorTabHeader } from '../src/editor/components/InspectorTabHeader.js';

describe('InspectorTabHeader', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('renders Page and Blocks tab buttons', () => {
    render(
      <InspectorTabHeader activeTab="page" onTabChange={vi.fn()} isReadOnly={false} />
    );
    expect(screen.getByRole('tab', { name: /page/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /blocks/i })).toBeInTheDocument();
  });

  it('active tab has aria-selected=true, inactive has aria-selected=false', () => {
    render(
      <InspectorTabHeader activeTab="page" onTabChange={vi.fn()} isReadOnly={false} />
    );
    expect(screen.getByRole('tab', { name: /page/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /blocks/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calling blocks tab when page is active calls onTabChange with "block"', () => {
    const onTabChange = vi.fn();
    render(
      <InspectorTabHeader activeTab="page" onTabChange={onTabChange} isReadOnly={false} />
    );
    fireEvent.click(screen.getByRole('tab', { name: /blocks/i }));
    expect(onTabChange).toHaveBeenCalledWith('block');
  });

  it('clicking the already-active tab does not call onTabChange', () => {
    const onTabChange = vi.fn();
    render(
      <InspectorTabHeader activeTab="page" onTabChange={onTabChange} isReadOnly={false} />
    );
    fireEvent.click(screen.getByRole('tab', { name: /page/i }));
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('isReadOnly=true does not disable the tab buttons', () => {
    render(
      <InspectorTabHeader activeTab="block" onTabChange={vi.fn()} isReadOnly={true} />
    );
    expect(screen.getByRole('tab', { name: /page/i })).not.toBeDisabled();
    expect(screen.getByRole('tab', { name: /blocks/i })).not.toBeDisabled();
  });

  it('switches active tab correctly when activeTab prop changes to block', () => {
    render(
      <InspectorTabHeader activeTab="block" onTabChange={vi.fn()} isReadOnly={false} />
    );
    expect(screen.getByRole('tab', { name: /blocks/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /page/i })).toHaveAttribute('aria-selected', 'false');
  });
});

// =============================================================================
// P1InspectorFields (orchestrator)
// Mock context and Puck state
// =============================================================================

const mockVersion: DocumentVersion = {
  id: 'v5',
  documentId: 'doc-1',
  versionNumber: 5,
  snapshot: {},
  createdAt: '2026-01-01T00:00:00Z',
  createdById: 'user-1',
};

const mockP1Context = {
  isViewingHistoricalVersion: false,
  viewingVersion: null as DocumentVersion | null,
  templates: [],
  currentDocument: null as { path: string } | null,
  updateTemplate: undefined as unknown,
};

vi.mock('../src/core/P1PuckContext.js', () => ({
  useP1Puck: () => mockP1Context,
  useP1PuckOptional: () => mockP1Context,
}));

const mockAppState = { ui: { itemSelector: null as unknown } };
const mockDispatch = vi.fn();

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => (selector: (state: unknown) => unknown) => {
    return selector({ appState: mockAppState, dispatch: mockDispatch });
  },
  usePuck: () => ({ dispatch: mockDispatch, config: { components: {} } }),
  ActionBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { P1InspectorFields } from '../src/editor/components/P1InspectorFields.js';

describe('P1InspectorFields', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Reset mutable mock state
    mockP1Context.isViewingHistoricalVersion = false;
    mockP1Context.viewingVersion = null;
    mockP1Context.currentDocument = null;
    mockP1Context.updateTemplate = undefined;
    mockAppState.ui.itemSelector = null;
  });

  it('does not render VersionReadOnlyBanner in normal editing mode', () => {
    render(
      <P1InspectorFields>
        <span data-testid="fields">fields content</span>
      </P1InspectorFields>
    );
    expect(screen.queryByText(/Viewing v/i)).toBeNull();
  });

  it('does not apply inert to fields in normal editing mode', () => {
    const { container } = render(
      <P1InspectorFields>
        <span data-testid="fields">fields content</span>
      </P1InspectorFields>
    );
    expect(container.querySelector('[inert]')).toBeNull();
  });

  it('renders VersionReadOnlyBanner in historical preview mode', () => {
    mockP1Context.isViewingHistoricalVersion = true;
    mockP1Context.viewingVersion = mockVersion;

    render(
      <P1InspectorFields>
        <span>fields</span>
      </P1InspectorFields>
    );
    expect(screen.getByText(/Viewing v5/)).toBeInTheDocument();
    expect(screen.getByText(/Fields are read-only/)).toBeInTheDocument();
  });

  it('applies inert to the fields guard in historical preview mode', () => {
    mockP1Context.isViewingHistoricalVersion = true;
    mockP1Context.viewingVersion = mockVersion;

    const { container } = render(
      <P1InspectorFields>
        <span>fields</span>
      </P1InspectorFields>
    );
    expect(container.querySelector('[inert]')).not.toBeNull();
  });

  it('shows Page tab as active when itemSelector is null', () => {
    mockAppState.ui.itemSelector = null;

    render(
      <P1InspectorFields>
        <span>fields</span>
      </P1InspectorFields>
    );
    expect(screen.getByRole('tab', { name: /page/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /blocks/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('shows Blocks tab as active when itemSelector is set', () => {
    mockAppState.ui.itemSelector = { zone: 'default-zone', index: 0 };

    render(
      <P1InspectorFields>
        <span>fields</span>
      </P1InspectorFields>
    );
    expect(screen.getByRole('tab', { name: /blocks/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /page/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('dispatches setUi with itemSelector null when Page tab clicked while block is selected', () => {
    mockAppState.ui.itemSelector = { zone: 'default-zone', index: 0 };

    render(
      <P1InspectorFields>
        <span>fields</span>
      </P1InspectorFields>
    );
    fireEvent.click(screen.getByRole('tab', { name: /page/i }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setUi', ui: { itemSelector: null } })
    );
  });

  it('renders children inside the guard', () => {
    render(
      <P1InspectorFields>
        <span data-testid="child-content">my fields</span>
      </P1InspectorFields>
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders children inside the guard in historical mode too', () => {
    mockP1Context.isViewingHistoricalVersion = true;
    mockP1Context.viewingVersion = mockVersion;

    render(
      <P1InspectorFields>
        <span data-testid="child-content">my fields</span>
      </P1InspectorFields>
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });
});
