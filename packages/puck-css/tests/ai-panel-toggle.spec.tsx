import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';
import { aiPanelStore } from '../src/editor/aiPanelStore.js';

// Stubbed to expose the one prop under test; reaching the real modal is three clicks of
// unrelated UI.
vi.mock('../src/pds/components/CreatePageModal.js', () => ({
  CreatePageModal: ({
    onGenerateWithAI,
  }: {
    onGenerateWithAI?: (brief: string, page: { path: string; title: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="generate-with-ai"
      onClick={() => onGenerateWithAI?.('a pricing page', { path: '/pricing', title: 'Pricing' })}
    >
      Generate
    </button>
  ),
}));

const { P1EditorHeader } = await import('../src/pds/components/P1EditorHeader.js');

const baseProps = {
  documents: [],
  currentDocument: null,
  siteName: 'Test Site',
  onSelectDocument: vi.fn(),
  onLogout: vi.fn(),
};

beforeEach(() => {
  aiPanelStore.close();
});
afterEach(() => {
  cleanup();
});

describe('P1EditorHeader — Pantheon AI toggle', () => {
  it('is absent unless the consumer opts in', () => {
    render(<P1EditorHeader {...baseProps} />);

    expect(screen.queryByTestId('ai-panel-toggle')).toBeNull();
  });

  it('opens and closes the panel, and reports its state to assistive tech', async () => {
    render(<P1EditorHeader {...baseProps} showAIPanelToggle />);
    const toggle = screen.getByTestId('ai-panel-toggle');

    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await act(async () => { toggle.click(); });
    expect(aiPanelStore.isOpen()).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    await act(async () => { toggle.click(); });
    expect(aiPanelStore.isOpen()).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('follows the store when something else opens the panel', async () => {
    render(<P1EditorHeader {...baseProps} showAIPanelToggle />);

    await act(async () => { aiPanelStore.open(); });

    expect(screen.getByTestId('ai-panel-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  // The panel can't reveal itself, so without this the seeded draft sends invisibly.
  it('opens the panel when a brief is handed over, and still forwards the brief', async () => {
    const onGenerateWithAI = vi.fn();
    render(<P1EditorHeader {...baseProps} onGenerateWithAI={onGenerateWithAI} />);

    await act(async () => { screen.getByTestId('generate-with-ai').click(); });

    expect(aiPanelStore.isOpen()).toBe(true);
    expect(onGenerateWithAI).toHaveBeenCalledWith('a pricing page', {
      path: '/pricing',
      title: 'Pricing',
    });
  });

  // The modal offers the AI flow based on whether the prop exists, so wrapping mustn't invent one.
  it('passes no handler to the modal when the consumer supplied none', async () => {
    render(<P1EditorHeader {...baseProps} />);

    await act(async () => { screen.getByTestId('generate-with-ai').click(); });

    expect(aiPanelStore.isOpen()).toBe(false);
  });
});
