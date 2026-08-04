/**
 * The no-derived-state rule, enforced.
 *
 * `useAutoSave` sends the entire Puck data object as the new version snapshot,
 * so anything written into `root.props` for the editor's benefit is persisted
 * into the document. Two things must therefore never touch `root.props` on the
 * editor path: role-derived read-only state, and inherited site/template
 * defaults used to power placeholders. Both must travel a non-persisted channel
 * instead — `resolveFields` for field shape, `<Puck metadata>` for values.
 *
 * This runs against real Puck (see this directory's vitest config) because the
 * package's default `@puckeditor/core` stub has no store and would pass
 * vacuously.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';

/**
 * Mirrors the shipped root config's shape (apps/p1-starter/components/puck/root.tsx).
 * The field set itself is asserted in that app's own tests; what matters here is
 * that `_meta` is an object field on the root, edited through Puck.
 */
const config = {
  root: {
    fields: {
      title: { type: 'text' as const, label: 'Title' },
      description: { type: 'textarea' as const, label: 'Description' },
      _meta: {
        type: 'object' as const,
        label: 'Metadata',
        objectFields: {
          ogTitle: { type: 'text' as const, label: 'OG title' },
          twitterCard: { type: 'text' as const, label: 'Twitter card' },
        },
      },
    },
    render: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  },
  components: {
    Block: {
      fields: { text: { type: 'text' as const, label: 'Block text' } },
      render: ({ text }: { text?: string }) => <div>{text}</div>,
    },
  },
};

const data = {
  root: { props: { title: 'Q3 Launch Recap', _meta: { ogTitle: '', twitterCard: '' } } },
  content: [{ type: 'Block', props: { id: 'block-1', text: 'hello' } }],
  zones: {},
} as unknown as Data;

/** What the editor would pass through `<Puck metadata>`: inherited values and role. */
const INHERITED = {
  inheritedOgTitle: 'Site default title',
  inheritedOgImage: 'https://cdn.example/site-default.jpg',
  userRole: 'editor',
};

function requireInput(container: HTMLElement, name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!input) throw new Error(`field input not rendered: ${name}`);
  return input;
}

describe('autosave payload', () => {
  it('carries no role-derived or inherited state into the persisted snapshot', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Puck
        config={config as never}
        data={data}
        iframe={{ enabled: false }}
        metadata={INHERITED}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[name="_meta.ogTitle"]')).not.toBeNull();
    });

    fireEvent.change(requireInput(container, '_meta.ogTitle'), {
      target: { value: 'Launch recap' },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    const call = onChange.mock.calls.at(-1);
    if (!call) throw new Error('onChange never fired');
    const payload = call[0] as Data;
    const root = payload.root as { props: Record<string, unknown>; readOnly?: unknown };

    // Role-derived readOnly lives on RootData — document data, not config.
    expect(root).not.toHaveProperty('readOnly');
    // The _seo fold (p1-store.ts) is public-reads-only and must stay that way.
    expect(Object.keys(root.props)).not.toContain('_seo');
    // Nothing from <Puck metadata> may leak into the snapshot.
    for (const key of Object.keys(INHERITED)) {
      expect(Object.keys(root.props)).not.toContain(key);
      expect(root.props._meta).not.toHaveProperty(key);
    }
    // The authored edit is present, and nothing else was added.
    expect(root.props._meta).toMatchObject({ ogTitle: 'Launch recap' });
    expect(Object.keys(root.props).sort()).toEqual(['_meta', 'title']);
  });
});
