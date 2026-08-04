/**
 * A collapsed field group shows one title, not two.
 *
 * Puck's object field always renders its own label row (`label: label || name`,
 * so blanking the field's label yields the raw prop name instead of nothing) and
 * the component rendering it is injected by AutoField, out of reach of a
 * `fieldTypes` override. The `fieldLabel` override can reach it, so the section
 * publishes the title it already rendered and the override drops the duplicate.
 *
 * Asserted against real Puck because it depends on Puck's own label plumbing.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, within, waitFor } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import { createP1Overrides, P1OverridesOptions } from '../src/editor/plugin/createP1Overrides.js';

// The shipped overrides, so this cannot drift from what the editor renders.
const p1Overrides = createP1Overrides({} as unknown as P1OverridesOptions) as unknown as Record<string, unknown>;
const overrides = {
  fieldLabel: p1Overrides.fieldLabel,
  fieldTypes: p1Overrides.fieldTypes,
};

const config = {
  root: {
    fields: {
      _meta: {
        type: 'object' as const,
        label: 'Metadata',
        metadata: { collapsible: true },
        objectFields: {
          ogTitle: { type: 'text' as const, label: 'Social title' },
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
  root: { props: { _meta: { ogTitle: '' }, _other: { plain: '' } } },
  content: [],
  zones: {},
} as unknown as Data;

// Puck renders the fields panel twice in the DOM, so queries are scoped to one.
async function renderPanel() {
  const { container } = render(
    <Puck
      config={config as never}
      data={data}
      iframe={{ enabled: false }}
      overrides={overrides as never}
    />,
  );
  await waitFor(() => {
    expect(container.querySelector('form')).not.toBeNull();
  });
  const form = container.querySelector('form');
  if (!form) throw new Error('fields panel never rendered');
  return within(form as HTMLElement);
}

describe('collapsible section label', () => {
  it('renders the section title exactly once', async () => {
    const panel = await renderPanel();
    expect(panel.getAllByText('Metadata')).toHaveLength(1);
  });

  it('keeps the sub-field labels', async () => {
    const panel = await renderPanel();
    expect(panel.getByText('Social title')).toBeInTheDocument();
  });

  it('leaves a non-collapsible object field’s own label alone', async () => {
    const panel = await renderPanel();
    expect(panel.getByText('Other')).toBeInTheDocument();
    expect(panel.getByText('Plain')).toBeInTheDocument();
  });
});
