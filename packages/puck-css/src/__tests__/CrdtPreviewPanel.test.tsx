/**
 * CrdtPreviewPanel Tests
 *
 * Tests for the CRDT preview panel - loading, error, success states,
 * and three-way visual comparison via Puck Render.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { CrdtPreviewPanel } from '../components/merge-resolution/CrdtPreviewPanel.js';
import type { PuckData } from '@pantheon/css-client';

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

const mockConfig = {
  components: {
    Text: { render: (props: Record<string, unknown>) => <p>{String(props.text)}</p> },
  },
};

describe('CrdtPreviewPanel', () => {
  it('shows loading state', () => {
    render(<CrdtPreviewPanel snapshot={null} loading={true} error={null} />);

    expect(screen.getByText('Loading CRDT merge preview...')).toBeDefined();
  });

  it('shows error state', () => {
    render(
      <CrdtPreviewPanel
        snapshot={null}
        loading={false}
        error="CRDT state not available for this document"
      />
    );

    expect(screen.getByText('CRDT state not available for this document')).toBeDefined();
  });

  it('shows empty state when no snapshot', () => {
    render(<CrdtPreviewPanel snapshot={null} loading={false} error={null} />);

    expect(screen.getByText('No CRDT preview available.')).toBeDefined();
  });

  it('shows success state with snapshot data (no config fallback)', () => {
    const snapshot: PuckData = {
      content: [{ type: 'Text', props: { id: 't1', text: 'merged' } }],
      root: { props: {} },
    };

    render(<CrdtPreviewPanel snapshot={snapshot} loading={false} error={null} />);

    expect(screen.getByText('CRDT merge preview loaded.')).toBeDefined();
    // Snapshot should be rendered as JSON when no config
    expect(screen.getByText(/merged/)).toBeDefined();
  });

  it('renders three-way comparison when all data provided', () => {
    const snapshot: PuckData = {
      content: [{ type: 'Text', props: { id: 't1', text: 'crdt-result' } }],
      root: { props: {} },
    };
    const sourceData: PuckData = {
      content: [{ type: 'Text', props: { id: 't1', text: 'source' } }],
      root: { props: {} },
    };
    const targetData: PuckData = {
      content: [{ type: 'Text', props: { id: 't1', text: 'target' } }],
      root: { props: {} },
    };

    render(
      <CrdtPreviewPanel
        snapshot={snapshot}
        loading={false}
        error={null}
        config={mockConfig}
        sourceData={sourceData}
        targetData={targetData}
        sourceBranchName="my-feature"
        targetBranchName="Live"
      />
    );

    // Should have three Render instances
    expect(screen.getAllByTestId('puck-render').length).toBe(3);
    // Should show panel labels
    expect(screen.getByText('my-feature')).toBeDefined();
    expect(screen.getByText('Auto-merged')).toBeDefined();
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('renders single panel when only snapshot and config provided (no source/target)', () => {
    const snapshot: PuckData = {
      content: [{ type: 'Text', props: { id: 't1', text: 'crdt-result' } }],
      root: { props: {} },
    };

    render(
      <CrdtPreviewPanel
        snapshot={snapshot}
        loading={false}
        error={null}
        config={mockConfig}
      />
    );

    // Single Render instance
    expect(screen.getAllByTestId('puck-render').length).toBe(1);
    expect(screen.getByText('Auto-merged')).toBeDefined();
  });
});
