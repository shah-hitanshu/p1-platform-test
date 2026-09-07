/**
 * Opening a document from a feature's control
 *
 * A feature asks for a document by path and the editor opens it the same way
 * the page selector does, so the URL and the selector move with the canvas.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@pantheon-systems/css-client', () => ({ P1Client: vi.fn() }));

const mockLoadDocument = vi.fn();
let registered: ((path: string) => void) | null = null;

const mockP1Context = {
  siteId: 'site-1',
  branches: [],
  currentBranch: null,
  documents: [],
  currentDocument: { id: 'doc-1', path: 'pricing' },
  loadDocument: mockLoadDocument,
  presence: null,
  templates: [],
  templatesLoading: false,
  registerDocumentOpener: (open: (path: string) => void) => {
    registered = open;
    return () => {
      registered = null;
    };
  },
};

vi.mock('../src/core/P1PuckContext.js', () => ({
  useP1Puck: () => mockP1Context,
  useP1PuckOptional: () => mockP1Context,
}));

import { useP1Plugin } from '../src/editor/useP1Plugin.js';

function Host({ onDocumentSelect }: { onDocumentSelect?: (path: string) => void }): null {
  useP1Plugin({ onDocumentSelect, selectedDocumentPath: 'pricing' });
  return null;
}

afterEach(() => {
  cleanup();
  registered = null;
  vi.clearAllMocks();
});

describe('the editor document opener', () => {
  it('opens through the app, which carries the URL with it', () => {
    const onDocumentSelect = vi.fn();
    render(<Host onDocumentSelect={onDocumentSelect} />);

    registered?.('pricing.fr-FR');

    expect(onDocumentSelect).toHaveBeenCalledWith('pricing.fr-FR');
    expect(mockLoadDocument).not.toHaveBeenCalled();
  });

  it('loads in place where the app routes no documents', () => {
    render(<Host />);

    registered?.('pricing.fr-FR');

    expect(mockLoadDocument).toHaveBeenCalledWith('pricing.fr-FR');
  });

  it('follows the app handler a later render supplies', () => {
    const onDocumentSelect = vi.fn();
    const { rerender } = render(<Host />);

    rerender(<Host onDocumentSelect={onDocumentSelect} />);
    registered?.('pricing.fr-FR');

    expect(onDocumentSelect).toHaveBeenCalledWith('pricing.fr-FR');
    expect(mockLoadDocument).not.toHaveBeenCalled();
  });

  it('withdraws the opener when the editor unmounts', () => {
    const { unmount } = render(<Host />);

    unmount();

    expect(registered).toBeNull();
  });
});
