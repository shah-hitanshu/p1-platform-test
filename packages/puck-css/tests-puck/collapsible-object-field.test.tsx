/**
 * The collapsible object field, against real Puck.
 *
 * Asserts the override composes with Puck's own object rendering rather than
 * replacing it, that opting out leaves other object fields alone, and — the part
 * that matters for the no-derived-state rule — that toggling the section writes
 * nothing to the document.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import { CollapsibleFieldSection } from '../src/editor/components/CollapsibleFieldSection.js';

const overrides = {
  fieldTypes: {
    object: ({
      field,
      children,
    }: {
      field: { label?: string; metadata?: { collapsible?: boolean; defaultCollapsed?: boolean } };
      children: React.ReactNode;
    }) =>
      field.metadata?.collapsible ? (
        <CollapsibleFieldSection
          label={field.label ?? ''}
          defaultCollapsed={field.metadata.defaultCollapsed}
        >
          {children}
        </CollapsibleFieldSection>
      ) : (
        <>{children}</>
      ),
  },
};

const config = {
  root: {
    fields: {
      title: { type: 'text' as const, label: 'Title' },
      _meta: {
        type: 'object' as const,
        label: 'Metadata',
        metadata: { collapsible: true, defaultCollapsed: true },
        objectFields: {
          ogTitle: { type: 'text' as const, label: 'Social title' },
          twitterCard: { type: 'text' as const, label: 'X card style' },
        },
      },
      _other: {
        type: 'object' as const,
        label: 'Other',
        objectFields: { plain: { type: 'text' as const, label: 'Plain' } },
      },
    },
    render: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  },
  components: {},
};

const data = {
  root: {
    props: {
      title: 'Q3 Launch Recap',
      _meta: { ogTitle: '', twitterCard: '' },
      _other: { plain: '' },
    },
  },
  content: [],
  zones: {},
} as unknown as Data;

const renderEditor = (onChange?: (d: Data) => void) =>
  render(
    <Puck
      config={config as never}
      data={data}
      iframe={{ enabled: false }}
      overrides={overrides as never}
      onChange={onChange}
    />,
  );

const input = (container: HTMLElement, name: string) =>
  container.querySelector(`[name="${name}"]`);

// Puck renders the fields panel twice in the DOM, so a document-wide query for
// the toggle is ambiguous. Scope to the panel this render owns.
const panel = (container: HTMLElement) => {
  const form = container.querySelector('form');
  if (!form) throw new Error('fields panel never rendered');
  return within(form as HTMLElement);
};

const metadataToggle = (container: HTMLElement) =>
  panel(container).getByRole('button', { name: /metadata/i });

describe('collapsible object field in Puck', () => {
  it('collapses the opted-in field and leaves other object fields expanded', async () => {
    const { container } = renderEditor();

    await waitFor(() => {
      expect(input(container, 'title')).not.toBeNull();
    });

    expect(input(container, '_other.plain')).not.toBeNull();
    expect(input(container, '_meta.ogTitle')).toBeNull();
  });

  it('renders Puck’s own sub-fields once expanded', async () => {
    const { container } = renderEditor();
    await waitFor(() => {
      expect(input(container, 'title')).not.toBeNull();
    });

    fireEvent.click(metadataToggle(container));

    expect(input(container, '_meta.ogTitle')).not.toBeNull();
    expect(input(container, '_meta.twitterCard')).not.toBeNull();
  });

  it('writes nothing to the document when toggled', async () => {
    const onChange = vi.fn();
    const { container } = renderEditor(onChange);
    await waitFor(() => {
      expect(input(container, 'title')).not.toBeNull();
    });

    const toggle = metadataToggle(container);
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(onChange).not.toHaveBeenCalled();
  });
});
