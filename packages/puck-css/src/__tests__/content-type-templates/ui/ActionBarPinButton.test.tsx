import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TemplateSummary } from '../../../features/content-type-templates/types.js';

const { puckSelectorMock, mockDispatch, mockCcrContext } = vi.hoisted(() => ({
  puckSelectorMock: vi.fn(),
  mockDispatch: vi.fn(),
  mockCcrContext: {
    userRole: 'admin' as string,
    currentDocument: null as { path: string } | null,
    templates: [] as TemplateSummary[],
    isViewingHistoricalVersion: false,
    client: {
      templates: {
        update: vi.fn().mockResolvedValue({}),
      },
    },
    siteId: 'site-1',
    branchId: 'branch-1',
  },
}));

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => puckSelectorMock,
  ActionBar: {
    Action: ({ children, label, onClick, active, disabled }: any) => (
      <button
        data-testid="pin-action"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    ),
  },
}));

vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Icon: ({ iconName, ...props }: any) => (
    <span data-testid={`icon-${iconName}`} {...props} />
  ),
}));

vi.mock('../../../core/P1PuckContext.js', () => ({
  useP1PuckOptional: () => mockCcrContext,
}));

import { ActionBarPinButton } from '../../../features/content-type-templates/ui/ActionBarPinButton.js';

const mockTemplateSummary: TemplateSummary = {
  id: 'template-1',
  name: 'blog-post',
  label: 'Blog Post',
  version: 1,
  updatedAt: '2026-06-08T00:00:00Z',
};

const mockContent = [
  { type: 'HeadingBlock', props: { id: 'comp-1', title: 'Hello' } },
  { type: 'TextBlock', props: { id: 'comp-2', body: 'World' } },
];

function setTemplateMode() {
  mockCcrContext.currentDocument = { path: '_registry/templates/blog-post' };
  mockCcrContext.templates = [mockTemplateSummary];
}

function setPuckState(selectedItem: any, pinMap: Record<string, boolean> = {}) {
  puckSelectorMock.mockImplementation((selector: (s: any) => any) =>
    selector({
      selectedItem,
      appState: { data: { content: mockContent, root: { props: { _pinMap: pinMap } } } },
      dispatch: mockDispatch,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCcrContext.userRole = 'admin';
  mockCcrContext.currentDocument = null;
  mockCcrContext.templates = [];
  mockCcrContext.isViewingHistoricalVersion = false;
  mockCcrContext.client.templates.update = vi.fn().mockResolvedValue({});
  setPuckState(null);
});

describe('ActionBarPinButton', () => {
  it('renders in template mode', () => {
    setTemplateMode();
    setPuckState(mockContent[0]);

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toBeInTheDocument();
  });

  it('should render nothing for a non-template document', () => {
    mockCcrContext.currentDocument = { path: 'some-page' };
    mockCcrContext.templates = [mockTemplateSummary];
    setPuckState(mockContent[0]);

    const { container } = render(<ActionBarPinButton />);
    expect(container.innerHTML).toBe('');
  });

  it('should render nothing for non-matching registry path', () => {
    mockCcrContext.currentDocument = { path: '_registry/components/button' };
    mockCcrContext.templates = [mockTemplateSummary];
    setPuckState(mockContent[0]);

    const { container } = render(<ActionBarPinButton />);
    expect(container.innerHTML).toBe('');
  });

  it('should render nothing when no component is selected', () => {
    setTemplateMode();
    setPuckState(null);

    const { container } = render(<ActionBarPinButton />);
    expect(container.innerHTML).toBe('');
  });

  it('should show disabled pin for non-admin users', () => {
    mockCcrContext.userRole = 'editor';
    setTemplateMode();
    setPuckState(mockContent[0]);

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toBeDisabled();
  });

  it('should show disabled pin for junior-editor role', () => {
    mockCcrContext.userRole = 'junior-editor';
    setTemplateMode();
    setPuckState(mockContent[0]);

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toBeDisabled();
  });

  it('should show disabled pin while viewing a historical version', () => {
    setTemplateMode();
    mockCcrContext.isViewingHistoricalVersion = true;
    setPuckState(mockContent[0]);

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toBeDisabled();
  });

  it('should show the pinned state for a pin loaded from a saved snapshot', () => {
    setTemplateMode();
    setPuckState(mockContent[0], { 'comp-1': true });

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-label', 'Unpin component');
    expect(screen.getByTestId('icon-lock')).toBeInTheDocument();
  });

  it('should show lockOpen icon for an unpinned component', () => {
    setTemplateMode();
    setPuckState(mockContent[1]);

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-label', 'Pin component');
    expect(screen.getByTestId('icon-lockOpen')).toBeInTheDocument();
  });

  it('persists the pin by writing _pinMap into the document root props', async () => {
    setTemplateMode();
    setPuckState(mockContent[1], { 'comp-1': true });

    render(<ActionBarPinButton />);
    fireEvent.click(screen.getByTestId('pin-action'));

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'setData' })
      );
    });

    // The setData updater merges the toggled pin into the existing pin map.
    const dispatched = mockDispatch.mock.calls[0][0] as {
      data: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    const next = dispatched.data({
      content: mockContent,
      root: { props: { _pinMap: { 'comp-1': true } } },
      zones: {},
    });
    expect((next.root as { props: Record<string, unknown> }).props._pinMap).toEqual({
      'comp-1': true,
      'comp-2': true,
    });

    // Pin persistence rides the normal document autosave.
    expect(mockCcrContext.client.templates.update).not.toHaveBeenCalled();
  });
});
