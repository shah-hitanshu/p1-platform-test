/**
 * CrdtPreviewPanel Tests
 *
 * Tests for the CRDT preview panel component - loading, error, and success states.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { CrdtPreviewPanel } from '../components/merge-resolution/CrdtPreviewPanel.js';
import type { PuckData } from '@pantheon/css-client';

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

  it('shows success state with snapshot data', () => {
    const snapshot: PuckData = {
      content: [{ type: 'Text', props: { id: 't1', text: 'merged' } }],
      root: { props: {} },
    };

    render(<CrdtPreviewPanel snapshot={snapshot} loading={false} error={null} />);

    expect(screen.getByText('CRDT merge preview loaded.')).toBeDefined();
    // Snapshot should be rendered as JSON
    expect(screen.getByText(/merged/)).toBeDefined();
  });
});
