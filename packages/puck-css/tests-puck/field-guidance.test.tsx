/**
 * Field help text and inherited-value placeholders, against real Puck.
 *
 * Two things are being proved. First, that help text opts in per field and
 * renders below the input without replacing Puck's own field rendering. Second —
 * the mechanism the inherited-value placeholder depends on — that a root
 * `resolveFields` re-runs when a root prop changes, so a placeholder derived from
 * the page title tracks the title as it is edited.
 *
 * That second one is not a given: the spike found that `metadata` changes do not
 * re-resolve fields at all. Root props are a different subscription, and this is
 * the test that says so.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import { createFieldGuidanceOverrides } from '../src/editor/plugin/fieldGuidance.js';

const overrides = createFieldGuidanceOverrides();

const metadataFields = {
  ogTitle: {
    type: 'text' as const,
    label: 'Social title',
    metadata: {
      help: 'Shown as the headline when the page is shared.',
      helpWhenEmpty: 'Inherited from title. Edit to override.',
    },
  },
  ogDescription: {
    type: 'textarea' as const,
    label: 'Social description',
    metadata: { helpWhenEmpty: 'Inherited from description. Edit to override.' },
  },
  ogType: {
    type: 'select' as const,
    label: 'Content type',
    options: [
      { label: 'Website', value: 'website' },
      { label: 'Article', value: 'article' },
    ],
    metadata: { help: 'Defaults to Website.' },
  },
  ogImage: { type: 'text' as const, label: 'Social image URL' },
};

function makeConfig() {
  return {
    root: {
      fields: {
        title: { type: 'text' as const, label: 'Title' },
        _meta: {
          type: 'object' as const,
          label: 'Metadata',
          objectFields: metadataFields,
        },
      },
      resolveFields: (data: { props?: Record<string, unknown> }) => ({
        title: { type: 'text' as const, label: 'Title' },
        _meta: {
          type: 'object' as const,
          label: 'Metadata',
          objectFields: {
            ...metadataFields,
            ogTitle: {
              ...metadataFields.ogTitle,
              placeholder: (data.props?.title as string) || undefined,
            },
          },
        },
      }),
      render: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    },
    components: {},
  };
}

const baseData = {
  root: {
    props: {
      title: 'Q3 Launch Recap',
      _meta: { ogTitle: '', ogDescription: '', ogType: 'website', ogImage: '' },
    },
  },
  content: [],
  zones: {},
} as unknown as Data;

const renderEditor = (onChange?: (d: Data) => void) =>
  render(
    <Puck
      config={makeConfig() as never}
      data={baseData}
      iframe={{ enabled: false }}
      overrides={overrides as never}
      onChange={onChange}
    />,
  );

const field = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);

// Puck renders the fields panel twice in the DOM, so a document-wide query is
// ambiguous. Scope to the panel this render owns.
const panel = (container: HTMLElement) => {
  const form = container.querySelector('form');
  if (!form) throw new Error('fields panel never rendered');
  return within(form as HTMLElement);
};

const ready = async (container: HTMLElement) => {
  await waitFor(() => {
    expect(field(container, '_meta.ogTitle')).not.toBeNull();
  });
};

describe('field help text in Puck', () => {
  it('renders the empty-state help below an opted-in field', async () => {
    const { container } = renderEditor();
    await ready(container);

    expect(
      panel(container).getByText('Inherited from title. Edit to override.'),
    ).toBeInTheDocument();
  });

  it('renders help after the input rather than replacing the field', async () => {
    const { container } = renderEditor();
    await ready(container);

    const input = field(container, '_meta.ogTitle');
    const help = panel(container).getByText('Inherited from title. Edit to override.');

    expect(input).not.toBeNull();
    expect(
      input!.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('swaps to the always-on help once the field is authored', async () => {
    const { container } = renderEditor();
    await ready(container);

    fireEvent.change(field(container, '_meta.ogTitle')!, { target: { value: 'Launch day' } });

    await waitFor(() => {
      expect(
        panel(container).getByText('Shown as the headline when the page is shared.'),
      ).toBeInTheDocument();
    });
    expect(
      panel(container).queryByText('Inherited from title. Edit to override.'),
    ).toBeNull();
  });

  it('supports textarea and select fields', async () => {
    const { container } = renderEditor();
    await ready(container);

    expect(
      panel(container).getByText('Inherited from description. Edit to override.'),
    ).toBeInTheDocument();
    expect(panel(container).getByText('Defaults to Website.')).toBeInTheDocument();
  });

  it('leaves a field without help metadata untouched', async () => {
    const { container } = renderEditor();
    await ready(container);

    const imageField = field(container, '_meta.ogImage');
    expect(imageField).not.toBeNull();
    // Puck's field wrapper is the nearest div ancestor; matching it by class
    // would mean matching a build-specific hash.
    expect(imageField!.closest('div')?.textContent).toBe('Social image URL');
  });

  it('writes nothing to the document by rendering help', async () => {
    const onChange = vi.fn();
    const { container } = renderEditor(onChange);
    await ready(container);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('inherited-value placeholder', () => {
  it('takes the placeholder from the current root prop', async () => {
    const { container } = renderEditor();
    await ready(container);

    expect(field(container, '_meta.ogTitle')!.placeholder).toBe('Q3 Launch Recap');
  });

  it('re-resolves the placeholder when the source prop changes', async () => {
    const { container } = renderEditor();
    await ready(container);

    fireEvent.change(field(container, 'title')!, { target: { value: 'Q4 Roadmap' } });

    await waitFor(() => {
      expect(field(container, '_meta.ogTitle')!.placeholder).toBe('Q4 Roadmap');
    });
  });

  it('never turns the placeholder into a persisted value', async () => {
    const onChange = vi.fn();
    const { container } = renderEditor(onChange);
    await ready(container);

    fireEvent.change(field(container, 'title')!, { target: { value: 'Q4 Roadmap' } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const last = onChange.mock.calls.at(-1)![0] as Data;
    expect((last.root.props as { _meta: Record<string, string> })._meta.ogTitle).toBe('');
  });
});
