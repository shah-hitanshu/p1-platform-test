import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PuckData } from '@pantheon/css-client';
import { createMergePreviewPlugin } from '../src/plugin/mergePreviewPlugin.js';

// Mock Puck's Render component
vi.mock('@puckeditor/core', () => ({
  Render: ({ data }: { data: PuckData }) => (
    <div data-testid="puck-render">
      {data.content.map((c, i) => (
        <div key={i} data-component-type={c.type}>
          {c.type}: {String(c.props.text ?? c.props.id)}
        </div>
      ))}
    </div>
  ),
}));

// Mock useMergePreview so plugin tests don't need a CSSPuckProvider
const mockUseMergePreview = vi.fn();
vi.mock('../src/hooks/useMergePreview.js', () => ({
  useMergePreview: () => mockUseMergePreview(),
}));

const sourceData: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Source Title' } },
    { type: 'Text', props: { id: 't1', text: 'Source paragraph' } },
  ],
  root: { props: {} },
};

const targetData: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Target Title' } },
    { type: 'Image', props: { id: 'i1', src: '/photo.jpg' } },
  ],
  root: { props: {} },
};

const mockConfig = {
  components: {
    Heading: { render: (props: Record<string, unknown>) => <h1>{String(props.text)}</h1> },
    Text: { render: (props: Record<string, unknown>) => <p>{String(props.text)}</p> },
    Image: { render: (props: Record<string, unknown>) => <img src={String(props.src)} /> },
  },
};

const documents = [
  {
    documentId: 'doc-1',
    documentPath: '/pages/home',
    sourceSnapshot: sourceData,
    targetSnapshot: targetData,
  },
  {
    documentId: 'doc-2',
    documentPath: '/pages/about',
    sourceSnapshot: {
      content: [{ type: 'Text', props: { id: 't2', text: 'Same' } }],
      root: { props: {} },
    },
    targetSnapshot: {
      content: [{ type: 'Text', props: { id: 't2', text: 'Same' } }],
      root: { props: {} },
    },
  },
];

const defaultMockReturn = {
  documents,
  loading: false,
  error: null,
  sourceBranchName: 'feature',
  targetBranchName: 'main',
  isMainBranch: false,
};

beforeEach(() => {
  mockUseMergePreview.mockReturnValue(defaultMockReturn);
});

describe('createMergePreviewPlugin', () => {
  it('should create a valid plugin object', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    expect(plugin.name).toBe('merge-preview');
    expect(plugin.label).toBeDefined();
    expect(plugin.render).toBeDefined();
    expect(typeof plugin.render).toBe('function');
  });

  it('should render the plugin panel', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());

    expect(screen.getByText(/merge preview/i)).toBeInTheDocument();
  });

  it('should show document list in the panel', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());

    expect(screen.getByText('/pages/home')).toBeInTheDocument();
    expect(screen.getByText('/pages/about')).toBeInTheDocument();
  });

  it('should show diff stats for documents with changes', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());

    const homeRow = screen.getByText('/pages/home').closest('.merge-preview-document');
    expect(homeRow).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    mockUseMergePreview.mockReturnValue({ ...defaultMockReturn, loading: true, documents: [] });

    const plugin = createMergePreviewPlugin({ config: mockConfig });
    render(plugin.render());

    expect(screen.getByText(/loading comparison/i)).toBeInTheDocument();
  });

  it('shows error state on failure', () => {
    mockUseMergePreview.mockReturnValue({
      ...defaultMockReturn,
      loading: false,
      error: new Error('Network error'),
      documents: [],
    });

    const plugin = createMergePreviewPlugin({ config: mockConfig });
    render(plugin.render());

    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  it('shows main-branch message when on main', () => {
    mockUseMergePreview.mockReturnValue({
      ...defaultMockReturn,
      isMainBranch: true,
      documents: [],
    });

    const plugin = createMergePreviewPlugin({ config: mockConfig });
    render(plugin.render());

    expect(screen.getByText(/switch to a workstream/i)).toBeInTheDocument();
  });
});

describe('MergePreviewPlugin - Panel interactions', () => {
  it('should show view mode selector', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());

    fireEvent.click(screen.getByText('/pages/home'));

    expect(screen.getByText(/side by side/i)).toBeInTheDocument();
  });

  it('should switch view modes', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());

    fireEvent.click(screen.getByText('/pages/home'));

    const overlayBtn = screen.getByText(/overlay/i);
    expect(overlayBtn).toBeInTheDocument();

    fireEvent.click(overlayBtn);

    expect(overlayBtn.closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('should call onDocumentSelect when a document is clicked', () => {
    const onDocumentSelect = vi.fn();
    const plugin = createMergePreviewPlugin({ config: mockConfig, onDocumentSelect });

    render(plugin.render());

    fireEvent.click(screen.getByText('/pages/home'));
    expect(onDocumentSelect).toHaveBeenCalledWith('doc-1');
  });

  it('should show empty state when no documents', () => {
    mockUseMergePreview.mockReturnValue({ ...defaultMockReturn, documents: [] });

    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());

    expect(screen.getByText(/no documents/i)).toBeInTheDocument();
  });

  it('should show a close button when a document is expanded', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());
    fireEvent.click(screen.getByText('/pages/home'));

    expect(screen.getByRole('button', { name: /close preview/i })).toBeInTheDocument();
  });

  it('should collapse expanded document when close button is clicked', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());
    fireEvent.click(screen.getByText('/pages/home'));

    expect(screen.getByRole('button', { name: /close preview/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close preview/i }));

    expect(screen.queryByText(/side by side/i)).not.toBeInTheDocument();
  });

  it('should collapse expanded document when clicking its row again', () => {
    const plugin = createMergePreviewPlugin({ config: mockConfig });

    render(plugin.render());

    const homeRow = screen.getByRole('button', { name: '/pages/home' });
    fireEvent.click(homeRow);
    expect(screen.getByText(/side by side/i)).toBeInTheDocument();

    fireEvent.click(homeRow);
    expect(screen.queryByText(/side by side/i)).not.toBeInTheDocument();
  });
});
