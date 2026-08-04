/**
 * The field count on a collapsible field group, against real Puck.
 *
 * The count is derived from the group's own `objectFields` rather than passed in,
 * so it cannot drift from what the group actually contains — including when
 * `resolveFields` omits a field, which is how role gating will hide one.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import { createP1Overrides, P1OverridesOptions } from '../src/editor/plugin/createP1Overrides.js';

// Only the field overrides: `fields` and `headerActions` need editor context this
// harness does not stand up. Taken from the shipped factory so this cannot drift.
const p1Overrides = createP1Overrides({} as unknown as P1OverridesOptions) as unknown as Record<string, unknown>;
const overrides = { fieldLabel: p1Overrides.fieldLabel, fieldTypes: p1Overrides.fieldTypes };

const metadataFields = {
  ogTitle: { type: 'text' as const, label: 'og:title' },
  ogDescription: { type: 'textarea' as const, label: 'og:description' },
  twitterTitle: { type: 'text' as const, label: 'twitter:title' },
};

function makeConfig(omit?: string) {
  const objectFields = Object.fromEntries(
    Object.entries(metadataFields).filter(([name]) => name !== omit),
  );

  return {
    root: {
      fields: {
        title: { type: 'text' as const, label: 'title' },
        _meta: {
          type: 'object' as const,
          label: 'Social & sharing',
          metadata: { collapsible: true, defaultCollapsed: true },
          objectFields: metadataFields,
        },
      },
      resolveFields: () => ({
        title: { type: 'text' as const, label: 'title' },
        _meta: {
          type: 'object' as const,
          label: 'Social & sharing',
          metadata: { collapsible: true, defaultCollapsed: true },
          objectFields,
        },
      }),
      render: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    },
    components: {},
  };
}

const data = {
  root: { props: { title: 'Q3', _meta: { ogTitle: '', ogDescription: '', twitterTitle: '' } } },
  content: [],
  zones: {},
} as unknown as Data;

const renderEditor = (omit?: string) =>
  render(
    <Puck
      config={makeConfig(omit) as never}
      data={data}
      iframe={{ enabled: false }}
      overrides={overrides as never}
    />,
  );

// Puck renders the fields panel twice in the DOM, so scope to this render's panel.
const toggle = async (container: HTMLElement) => {
  const form = await waitFor(() => {
    const found = container.querySelector('form');
    if (!found) throw new Error('fields panel never rendered');
    return found as HTMLElement;
  });
  return within(form).getByRole('button', { name: /social & sharing/i });
};

describe('collapsible field group count', () => {
  it('counts the fields in the group', async () => {
    const { container } = renderEditor();

    expect((await toggle(container)).textContent).toContain('3');
  });

  it('follows resolveFields when a field is omitted', async () => {
    const { container } = renderEditor('twitterTitle');

    expect((await toggle(container)).textContent).toContain('2');
  });

  it('keeps the count visible while the group is expanded', async () => {
    const { container } = renderEditor();
    const button = await toggle(container);

    fireEvent.click(button);

    expect((await toggle(container)).textContent).toContain('3');
  });
});
