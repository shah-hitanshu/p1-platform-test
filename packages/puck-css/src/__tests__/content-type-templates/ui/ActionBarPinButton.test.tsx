import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Template } from '../../../features/content-type-templates/types.js';

const { puckSelectorMock, mockDispatch, mockRefreshPermissions, mockCssContext } = vi.hoisted(() => ({
  puckSelectorMock: vi.fn(),
  mockDispatch: vi.fn(),
  mockRefreshPermissions: vi.fn().mockResolvedValue(undefined),
  mockCssContext: {
    userRole: 'admin' as string,
    currentTemplate: null as Template | null,
    currentDocument: null as { path: string } | null,
    templates: [] as Template[],
    client: {
      templates: {
        update: vi.fn().mockResolvedValue({}),
      },
    },
    siteId: 'site-1',
    branchId: 'branch-1',
    refreshTemplates: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => puckSelectorMock,
  usePuck: () => ({ dispatch: mockDispatch, refreshPermissions: mockRefreshPermissions }),
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
  useP1PuckOptional: () => mockCssContext,
}));

import { ActionBarPinButton } from '../../../features/content-type-templates/ui/ActionBarPinButton.js';

const mockTemplate: Template = {
  id: 'template-1',
  name: 'blog-post',
  label: 'Blog Post',
  version: 1,
  components: [
    { type: 'HeadingBlock', pinned: true, defaultProps: {} },
    { type: 'TextBlock', pinned: false, defaultProps: {} },
  ],
  createdAt: '2026-06-08T00:00:00Z',
  updatedAt: '2026-06-08T00:00:00Z',
};

const mockContent = [
  { type: 'HeadingBlock', props: { id: 'comp-1', title: 'Hello' } },
  { type: 'TextBlock', props: { id: 'comp-2', body: 'World' } },
];

function setPuckState(selectedItem: any, pinMap: Record<string, boolean> = {}) {
  puckSelectorMock.mockImplementation((selector: (s: any) => any) =>
    selector({
      selectedItem,
      appState: { data: { content: mockContent, root: { props: { _pinMap: pinMap } } } },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCssContext.userRole = 'admin';
  mockCssContext.currentTemplate = null;
  mockCssContext.currentDocument = null;
  mockCssContext.templates = [];
  mockCssContext.client.templates.update = vi.fn().mockResolvedValue({});
  mockCssContext.refreshTemplates = vi.fn().mockResolvedValue(undefined);
  setPuckState(null);
});

describe('ActionBarPinButton', () => {
  it('should show disabled pin for non-admin users', () => {
    mockCssContext.userRole = 'editor';
    mockCssContext.currentTemplate = mockTemplate;
    setPuckState(mockContent[0]);

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toBeDisabled();
  });

  it('should render nothing when no template is bound and not a registry doc', () => {
    mockCssContext.currentTemplate = null;
    mockCssContext.currentDocument = { path: 'some-page' };
    setPuckState(mockContent[0]);

    const { container } = render(<ActionBarPinButton />);
    expect(container.innerHTML).toBe('');
  });

  it('should render nothing when no component is selected', () => {
    mockCssContext.currentTemplate = mockTemplate;
    setPuckState(null);

    const { container } = render(<ActionBarPinButton />);
    expect(container.innerHTML).toBe('');
  });

  it('should show lock icon for a pinned component (template-bound doc)', () => {
    mockCssContext.currentTemplate = mockTemplate;
    setPuckState(mockContent[0], { 'comp-1': true });

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-label', 'Unpin component');
    expect(screen.getByTestId('icon-lock')).toBeInTheDocument();
  });

  it('should show lockOpen icon for an unpinned component', () => {
    mockCssContext.currentTemplate = mockTemplate;
    setPuckState(mockContent[1]);

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-label', 'Pin component');
    expect(screen.getByTestId('icon-lockOpen')).toBeInTheDocument();
  });

  it('should resolve template from registry document path', () => {
    mockCssContext.currentTemplate = null;
    mockCssContext.currentDocument = { path: '_registry/templates/blog-post' };
    mockCssContext.templates = [mockTemplate];
    setPuckState(mockContent[0], { 'comp-1': true });

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('icon-lock')).toBeInTheDocument();
  });

  it('should call templates.update and refreshTemplates on click', async () => {
    mockCssContext.currentTemplate = mockTemplate;
    setPuckState(mockContent[1], { 'comp-1': true });

    render(<ActionBarPinButton />);
    fireEvent.click(screen.getByTestId('pin-action'));

    await waitFor(() => {
      expect(mockCssContext.client.templates.update).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'template-1',
        {
          components: [
            { type: 'HeadingBlock', pinned: true, defaultProps: {} },
            { type: 'TextBlock', pinned: true, defaultProps: {} },
          ],
        }
      );
    });

    expect(mockCssContext.refreshTemplates).toHaveBeenCalled();
  });

  it('should show disabled pin for junior-editor role', () => {
    mockCssContext.userRole = 'junior-editor';
    mockCssContext.currentTemplate = mockTemplate;
    setPuckState(mockContent[0]);

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toBeDisabled();
  });

  it('should show unpinned when component index exceeds template components', () => {
    mockCssContext.currentTemplate = {
      ...mockTemplate,
      components: [{ type: 'HeadingBlock', pinned: true, defaultProps: {} }],
    };
    setPuckState(mockContent[1]); // index 1, template only has 1 component

    render(<ActionBarPinButton />);
    expect(screen.getByTestId('pin-action')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('icon-lockOpen')).toBeInTheDocument();
  });

  it('should render nothing for non-matching registry path', () => {
    mockCssContext.currentTemplate = null;
    mockCssContext.currentDocument = { path: '_registry/components/button' };
    mockCssContext.templates = [mockTemplate];
    setPuckState(mockContent[0]);

    const { container } = render(<ActionBarPinButton />);
    expect(container.innerHTML).toBe('');
  });

  it('should call refreshPermissions after toggling pin state', async () => {
    mockCssContext.currentTemplate = mockTemplate;
    setPuckState(mockContent[1]);

    render(<ActionBarPinButton />);
    fireEvent.click(screen.getByTestId('pin-action'));

    await waitFor(() => {
      expect(mockCssContext.client.templates.update).toHaveBeenCalled();
    });

    expect(mockRefreshPermissions).toHaveBeenCalled();
  });
});
