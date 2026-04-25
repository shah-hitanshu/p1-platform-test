/**
 * MergePreviewPanel Null Snapshot Tests (Issue #32)
 *
 * Tests that MergePreviewPanel guards against null sourceSnapshot
 * and targetSnapshot values when rendering branch-only documents.
 *
 * The crash occurs because sourceSnapshot/targetSnapshot are unsafely
 * cast to PuckData without null-checking, causing Puck's Render
 * component to crash when accessing `.content.length` on null.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PuckData } from '@pantheon/css-client';
import type { DocumentDiffSummary } from '../src/utils/branchDiff.js';
import { MergePreviewPanel } from '../src/components/merge-preview/MergePreviewPanel.js';

// Mock Puck's Render component to avoid deep dependency on Puck internals.
// The mock verifies that data passed to Render is never null.
vi.mock('@puckeditor/core', () => ({
  Render: ({ data }: { data: PuckData }) => (
    <div data-testid="puck-render" data-content-count={data.content.length}>
      {data.content.map((c, i) => (
        <div key={i} data-component-type={c.type}>
          {c.type}
        </div>
      ))}
    </div>
  ),
}));

const mockConfig = {
  components: {
    Heading: {
      render: (props: Record<string, unknown>) => <h1>{String(props.text)}</h1>,
    },
    Text: {
      render: (props: Record<string, unknown>) => <p>{String(props.text)}</p>,
    },
  },
};

const validSourceData: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Source Title' } },
    { type: 'Text', props: { id: 't1', text: 'Same paragraph' } },
  ],
  root: { props: {} },
};

const validTargetData: PuckData = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Target Title' } },
    { type: 'Text', props: { id: 't1', text: 'Same paragraph' } },
  ],
  root: { props: {} },
};

/**
 * Helper to create a DocumentDiffSummary with given snapshots.
 */
function makeDocument(
  id: string,
  source: unknown,
  target: unknown,
): DocumentDiffSummary {
  return {
    documentId: id,
    documentPath: `/pages/${id}`,
    sourceSnapshot: source,
    targetSnapshot: target,
  };
}

/**
 * Helper to render MergePreviewPanel and click a document to expand it.
 */
function renderAndExpand(documents: DocumentDiffSummary[]) {
  const result = render(
    <MergePreviewPanel
      documents={documents}
      sourceBranchName="feature"
      targetBranchName="main"
      config={mockConfig}
    />,
  );

  // Click the first document to expand it
  const button = screen.getByText(documents[0].documentPath);
  fireEvent.click(button);

  return result;
}

describe('MergePreviewPanel null snapshot handling (issue #32)', () => {
  it('renders without crashing when both snapshots are valid PuckData', () => {
    const documents = [makeDocument('doc-1', validSourceData, validTargetData)];
    const { container } = renderAndExpand(documents);

    // Should render without throwing; Puck Render should receive valid data
    const renderOutputs = container.querySelectorAll('[data-testid="puck-render"]');
    expect(renderOutputs.length).toBeGreaterThan(0);
  });

  it('renders without crashing when targetSnapshot is null (branch-only document)', () => {
    const documents = [makeDocument('doc-new', validSourceData, null)];

    // This is the main crash case from issue #32.
    // Before the fix, this throws because null is passed to Render.
    expect(() => renderAndExpand(documents)).not.toThrow();

    // Puck Render should have been called with non-null data
    const renderOutputs = screen.getAllByTestId('puck-render');
    for (const output of renderOutputs) {
      // Each Render call should have received data with a content array
      expect(output.getAttribute('data-content-count')).not.toBeNull();
    }
  });

  it('renders without crashing when sourceSnapshot is null (deleted on source)', () => {
    const documents = [makeDocument('doc-deleted', null, validTargetData)];

    expect(() => renderAndExpand(documents)).not.toThrow();

    const renderOutputs = screen.getAllByTestId('puck-render');
    for (const output of renderOutputs) {
      expect(output.getAttribute('data-content-count')).not.toBeNull();
    }
  });

  it('renders without crashing when both snapshots are null', () => {
    const documents = [makeDocument('doc-empty', null, null)];

    // When both are null, createBranchDocumentComparison returns empty diffs
    // and the renderer shows "No changes" -- it should not crash.
    expect(() => renderAndExpand(documents)).not.toThrow();
  });
});
