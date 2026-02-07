/**
 * Merge Preview Plugin Tests (TDD - Phase 5)
 *
 * Tests for the Puck plugin that renders merged state preview
 * with visual diff highlighting.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PuckData } from '@pantheon/css-client';
import { createMergePreviewPlugin } from '../src/plugin/mergePreviewPlugin.js';
import type { MergePreviewPluginOptions } from '../src/plugin/mergePreviewPlugin.js';

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

describe('createMergePreviewPlugin', () => {
  it('should create a valid plugin object', () => {
    const plugin = createMergePreviewPlugin({
      documents,
      sourceBranchName: 'feature',
      targetBranchName: 'main',
      config: mockConfig,
    });

    expect(plugin.name).toBe('merge-preview');
    expect(plugin.label).toBeDefined();
    expect(plugin.render).toBeDefined();
    expect(typeof plugin.render).toBe('function');
  });

  it('should render the plugin panel', () => {
    const plugin = createMergePreviewPlugin({
      documents,
      sourceBranchName: 'feature',
      targetBranchName: 'main',
      config: mockConfig,
    });

    render(plugin.render());

    // Should show branch names or merge context
    expect(screen.getByText(/merge preview/i)).toBeInTheDocument();
  });

  it('should show document list in the panel', () => {
    const plugin = createMergePreviewPlugin({
      documents,
      sourceBranchName: 'feature',
      targetBranchName: 'main',
      config: mockConfig,
    });

    render(plugin.render());

    expect(screen.getByText('/pages/home')).toBeInTheDocument();
    expect(screen.getByText('/pages/about')).toBeInTheDocument();
  });

  it('should show diff stats for documents with changes', () => {
    const plugin = createMergePreviewPlugin({
      documents,
      sourceBranchName: 'feature',
      targetBranchName: 'main',
      config: mockConfig,
    });

    render(plugin.render());

    // doc-1 has changes (modified heading, removed text, added image)
    // Should show some change indicator
    const homeRow = screen.getByText('/pages/home').closest('.merge-preview-document');
    expect(homeRow).toBeInTheDocument();
  });
});

describe('MergePreviewPlugin - Panel interactions', () => {
  it('should show view mode selector', () => {
    const plugin = createMergePreviewPlugin({
      documents,
      sourceBranchName: 'feature',
      targetBranchName: 'main',
      config: mockConfig,
    });

    render(plugin.render());

    // Click on a document to expand it
    fireEvent.click(screen.getByText('/pages/home'));

    // Should show view mode options
    expect(screen.getByText(/side by side/i)).toBeInTheDocument();
  });

  it('should switch view modes', () => {
    const plugin = createMergePreviewPlugin({
      documents,
      sourceBranchName: 'feature',
      targetBranchName: 'main',
      config: mockConfig,
    });

    render(plugin.render());

    // Click on a document
    fireEvent.click(screen.getByText('/pages/home'));

    // Check overlay mode button exists
    const overlayBtn = screen.getByText(/overlay/i);
    expect(overlayBtn).toBeInTheDocument();

    // Switch to overlay
    fireEvent.click(overlayBtn);

    // Overlay mode should be active
    expect(overlayBtn.closest('button')).toHaveClass('view-mode-selector__btn--active');
  });

  it('should call onDocumentSelect when a document is clicked', () => {
    const onDocumentSelect = vi.fn();
    const plugin = createMergePreviewPlugin({
      documents,
      sourceBranchName: 'feature',
      targetBranchName: 'main',
      config: mockConfig,
      onDocumentSelect,
    });

    render(plugin.render());

    fireEvent.click(screen.getByText('/pages/home'));
    expect(onDocumentSelect).toHaveBeenCalledWith('doc-1');
  });

  it('should show empty state when no documents', () => {
    const plugin = createMergePreviewPlugin({
      documents: [],
      sourceBranchName: 'feature',
      targetBranchName: 'main',
      config: mockConfig,
    });

    render(plugin.render());

    expect(screen.getByText(/no documents/i)).toBeInTheDocument();
  });
});
