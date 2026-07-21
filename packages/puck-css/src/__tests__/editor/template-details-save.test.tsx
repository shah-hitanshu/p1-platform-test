/**
 * Template details save: the fields override's TemplateDetailsPanel persists
 * metadata via updateTemplate AND mirrors the saved values into the live Puck
 * root props (`root.props._template`), so the next canvas autosave writes the
 * same metadata the PATCH persisted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import type { TemplateSummary } from '../../features/content-type-templates/types.js';

const { puckSelectorMock, mockDispatch, mockCssContext } = vi.hoisted(() => ({
  puckSelectorMock: vi.fn(),
  mockDispatch: vi.fn(),
  mockCssContext: {
    currentDocument: { path: '_registry/templates/blog-post' } as { path: string } | null,
    templates: [] as unknown[],
    updateTemplate: vi.fn(),
  },
}));

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => puckSelectorMock,
  usePuck: () => ({ dispatch: mockDispatch, refreshPermissions: vi.fn() }),
  ActionBar: Object.assign(
    ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    {
      Action: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
    },
  ),
}));

vi.mock('../../core/P1PuckContext.js', () => ({
  useP1PuckOptional: () => mockCssContext,
  useP1Puck: () => mockCssContext,
}));

import { createP1Overrides } from '../../editor/plugin/createP1Overrides.js';

const templateSummary: TemplateSummary = {
  id: 'template-1',
  name: 'blog-post',
  label: 'Blog Post',
  version: 1,
  updatedAt: '2026-06-08T00:00:00Z',
};

function renderFieldsOverride() {
  const overrides = createP1Overrides({ onRetrySave: vi.fn() });
  const Fields = overrides.fields as (props: {
    children: React.ReactNode;
  }) => React.ReactElement;
  return render(<Fields>{<div data-testid="default-fields" />}</Fields>);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockCssContext.currentDocument = { path: '_registry/templates/blog-post' };
  mockCssContext.templates = [templateSummary];
  mockCssContext.updateTemplate = vi.fn().mockResolvedValue(undefined);
  // Nothing selected on the canvas (root fields shown).
  puckSelectorMock.mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ appState: { ui: { itemSelector: null } } }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('template details save', () => {
  it('PATCHes the metadata and mirrors it into the live Puck root props', async () => {
    renderFieldsOverride();

    fireEvent.change(screen.getByTestId('template-details-label'), {
      target: { value: 'Renamed Post' },
    });
    // Panel autosave debounce is 600ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(mockCssContext.updateTemplate).toHaveBeenCalledWith('template-1', {
      label: 'Renamed Post',
      description: '',
      defaultUrlPattern: '',
    });

    // The saved metadata is dispatched into Puck so autosave stays in
    // agreement with the PATCHed snapshot.
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setData' }),
    );
    const setDataCall = mockDispatch.mock.calls.find(
      (c) => (c[0] as { type: string }).type === 'setData',
    );
    if (!setDataCall) throw new Error('setData was not dispatched');
    const dispatched = setDataCall[0] as {
      data: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    const prev = {
      content: [{ type: 'HeadingBlock', props: { id: 'comp-1' } }],
      root: {
        props: {
          _template: { label: 'Blog Post', deprecated: false },
          _pinMap: { 'comp-1': true },
        },
      },
      zones: {},
    };
    const next = dispatched.data(prev) as typeof prev;
    expect(next.root.props._template).toEqual({
      label: 'Renamed Post',
      description: '',
      defaultUrlPattern: '',
      deprecated: false,
    });
    // Content, pins, and zones ride through unchanged.
    expect(next.root.props._pinMap).toEqual({ 'comp-1': true });
    expect(next.content).toEqual(prev.content);
    expect(next.zones).toEqual({});
  });

  it('does not touch the live Puck data when the metadata PATCH fails', async () => {
    mockCssContext.updateTemplate = vi.fn().mockRejectedValue(new Error('boom'));
    renderFieldsOverride();

    fireEvent.change(screen.getByTestId('template-details-label'), {
      target: { value: 'Renamed Post' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(mockCssContext.updateTemplate).toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
