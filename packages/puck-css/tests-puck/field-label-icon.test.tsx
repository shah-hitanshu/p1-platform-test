/**
 * Field labels carry no field-type icon, against real Puck.
 *
 * Puck labels each field with a type glyph — `T` for text, a chevron for select.
 * The select chevron is the same glyph our collapsible section headers use for a
 * disclosure, so it reads as a group that expands and then does nothing. The
 * `fieldLabel` override drops the icon for every field type at once; these tests
 * pin that, and pin that the read-only lock — a separate slot on the same row —
 * is not dropped with it.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import { P1FieldLabel } from '../src/editor/plugin/createP1Overrides.js';

// Only the label override, so the assertions are about it rather than about the
// editor chrome the full override set needs a live editor context to render.
const overrides = { fieldLabel: P1FieldLabel };

const config = {
  root: {
    fields: {
      title: { type: 'text' as const, label: 'Title' },
      description: { type: 'textarea' as const, label: 'Description' },
      ogType: {
        type: 'select' as const,
        label: 'og:type',
        options: [
          { label: 'Website', value: 'website' },
          { label: 'Article', value: 'article' },
        ],
      },
    },
    render: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  },
  components: {},
};

const data = {
  root: { props: { title: 'Q3 Launch Recap', description: '', ogType: 'website' } },
  content: [],
  zones: {},
} as unknown as Data;

const renderEditor = (readOnly?: Record<string, boolean>) =>
  render(
    <Puck
      config={config as never}
      data={{ ...data, root: { ...data.root, readOnly } } as Data}
      iframe={{ enabled: false }}
      overrides={overrides as never}
    />,
  );

// Puck renders the fields panel twice in the DOM, so a document-wide query is
// ambiguous. Scope to the panel this render owns.
const panel = (container: HTMLElement) => {
  const form = container.querySelector('form');
  if (!form) throw new Error('fields panel never rendered');
  return form as HTMLElement;
};

const ready = async (container: HTMLElement) => {
  await waitFor(() => {
    expect(panel(container).querySelector('[title="og:type"]')).not.toBeNull();
  });
};

describe('field label icons', () => {
  it('renders no field-type icon on any field', async () => {
    const { container } = renderEditor();
    await ready(container);

    // Puck's icons are the only lucide glyphs the fields panel would render.
    expect(panel(container).querySelectorAll('[class*="lucide"]')).toHaveLength(0);
  });

  it('renders no chevron beside a select', async () => {
    const { container } = renderEditor();
    await ready(container);

    expect(panel(container).querySelector('.lucide-chevron-down')).toBeNull();
  });

  it('still labels every field', async () => {
    const { container } = renderEditor();
    await ready(container);

    const text = panel(container).textContent ?? '';
    expect(text).toContain('Title');
    expect(text).toContain('Description');
    expect(text).toContain('og:type');
  });

  it('keeps the read-only lock, which is a different slot', async () => {
    const { container } = renderEditor({ title: true });
    await ready(container);

    expect(panel(container).querySelector('.lucide-lock')).not.toBeNull();
  });
});
