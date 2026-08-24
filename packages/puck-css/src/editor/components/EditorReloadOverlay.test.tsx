/**
 * Tests for <EditorReloadOverlay />.
 *
 * The copy is the point of this component: a workstream switch and a page
 * switch are both `loading` to the editor, and announcing the wrong one is
 * exactly the bug that moving this out of the starter app fixes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { EditorReloadOverlay } from './EditorReloadOverlay.js';

afterEach(() => {
  cleanup();
});

describe('EditorReloadOverlay', () => {
  it('renders nothing when no reload is in flight', () => {
    const { container } = render(<EditorReloadOverlay reloading={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('names the workstream switch', () => {
    render(<EditorReloadOverlay reloading="branch" />);
    expect(screen.getByTestId('editor-reloading-branch').textContent).toContain(
      'Switching workstream',
    );
  });

  it('does not call a page switch a workstream switch', () => {
    render(<EditorReloadOverlay reloading="document" />);
    const overlay = screen.getByTestId('editor-reloading-document');
    expect(overlay.textContent).toContain('Loading page');
    expect(overlay.textContent).not.toContain('workstream');
  });
});
