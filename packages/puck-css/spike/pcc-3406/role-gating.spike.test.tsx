/**
 * PCC-3406 Phase 0 spike — subtask 1.
 *
 * Exercises real Puck 0.21.1 (this directory's vitest config deliberately drops
 * the `@puckeditor/core` stub alias) to answer the three Phase 0 spike items:
 *
 *   1. Does a role-varying root `resolveFields` render, and does omitting keys
 *      from inside an object field actually hide them?
 *   2. Can the Page tab be left showing stale, unresolved, or wrong fields?
 *   3. Does anything role-derived or inherited reach the payload that
 *      useAutoSave persists as the version snapshot?
 *
 * Findings are written up in FINDINGS.md next to this file.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';

type Role = 'admin' | 'editor';

/** Puck's rootDroppableId — `${rootAreaId}:${rootZone}`, not the bare zone name. */
const ROOT_ZONE = 'root:default-zone';

const VALUE_FIELDS = {
  ogTitle: { type: 'text' as const, label: 'OG title' },
  twitterCard: { type: 'text' as const, label: 'Twitter card' },
};

const ADMIN_ONLY_FIELDS = {
  _defs: { type: 'text' as const, label: 'Field definitions' },
};

interface ResolverCall {
  resolver: 'root' | 'Block';
  dataType?: string;
  metadata?: unknown;
}

function lastPayload(onChange: ReturnType<typeof vi.fn>): Data {
  const call = onChange.mock.calls.at(-1);
  if (!call) throw new Error('onChange never fired');
  return call[0] as Data;
}

let calls: ResolverCall[] = [];

function makeConfig(role: Role, opts: { rootDelayMs?: number } = {}) {
  const objectFields =
    role === 'admin' ? { ...VALUE_FIELDS, ...ADMIN_ONLY_FIELDS } : { ...VALUE_FIELDS };

  return {
    root: {
      fields: {
        title: { type: 'text' as const, label: 'Title' },
        _meta: {
          type: 'object' as const,
          label: 'Metadata',
          objectFields: { ...VALUE_FIELDS, ...ADMIN_ONLY_FIELDS },
        },
      },
      resolveFields: async (
        data: { type?: string },
        params: { metadata?: Record<string, unknown> },
      ) => {
        calls.push({ resolver: 'root', dataType: data?.type, metadata: params.metadata });
        if (opts.rootDelayMs) {
          await new Promise((r) => setTimeout(r, opts.rootDelayMs));
        }
        return {
          title: { type: 'text' as const, label: 'Title' },
          _meta: { type: 'object' as const, label: 'Metadata', objectFields },
        };
      },
      render: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    },
    components: {
      Block: {
        fields: { text: { type: 'text' as const, label: 'Block text' } },
        resolveFields: async (data: { type?: string }) => {
          calls.push({ resolver: 'Block', dataType: data?.type });
          return { text: { type: 'text' as const, label: 'Block text' } };
        },
        render: ({ text }: { text?: string }) => <div>{text}</div>,
      },
    },
  };
}

const BASE_DATA = {
  root: {
    props: {
      title: 'Q3 Launch Recap',
      _meta: { ogTitle: '', twitterCard: '', _defs: 'admin-only value' },
    },
  },
  content: [{ type: 'Block', props: { id: 'block-1', text: 'hello' } }],
  zones: {},
} as unknown as Data;

interface AppStore {
  getState: () => {
    dispatch: (action: unknown) => void;
    fields: { fields: Record<string, unknown>; id?: string; loading: boolean };
    selectedItem: { type: string; props: { id: string } } | null;
    getComponentConfig: (type?: string) => { fields?: Record<string, unknown> } | undefined;
  };
}

function getStore(): AppStore {
  const store = (window as unknown as { __PUCK_INTERNAL_DO_NOT_USE?: { appStore: AppStore } })
    .__PUCK_INTERNAL_DO_NOT_USE?.appStore;
  if (!store) throw new Error('Puck internal store not exposed');
  return store;
}

function renderPuck(
  role: Role,
  opts: {
    onChange?: (data: Data) => void;
    itemSelector?: { zone: string; index: number };
    metadata?: Record<string, unknown>;
    rootDelayMs?: number;
  } = {},
) {
  return render(
    <Puck
      key={`css-${role}`}
      config={makeConfig(role, { rootDelayMs: opts.rootDelayMs }) as never}
      data={BASE_DATA}
      iframe={{ enabled: false }}
      onChange={opts.onChange}
      {...(opts.itemSelector ? { ui: { itemSelector: opts.itemSelector } as never } : {})}
      {...(opts.metadata ? { metadata: opts.metadata } : {})}
    />,
  );
}

const fieldInput = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`[name="${name}"]`);

function requireFieldInput(container: HTMLElement, name: string): HTMLInputElement {
  const input = fieldInput(container, name);
  if (!input) throw new Error(`field input not rendered: ${name}`);
  return input;
}

const waitForRootFields = async (container: HTMLElement) =>
  waitFor(() => {
    expect(fieldInput(container, '_meta.ogTitle')).not.toBeNull();
  });

beforeEach(() => {
  calls = [];
});

describe('spike item 1 · role-gated root fields via resolveFields', () => {
  it('renders only the value fields for an editor', async () => {
    const { container } = renderPuck('editor');
    await waitForRootFields(container);

    expect(fieldInput(container, '_meta.twitterCard')).not.toBeNull();
    expect(fieldInput(container, '_meta._defs')).toBeNull();
  });

  it('renders the definition field for an admin', async () => {
    const { container } = renderPuck('admin');
    await waitForRootFields(container);

    expect(fieldInput(container, '_meta._defs')).not.toBeNull();
  });

  it('leaves the omitted key untouched in the data — omission is UX, not deletion', async () => {
    const onChange = vi.fn();
    const { container } = renderPuck('editor', { onChange });
    await waitForRootFields(container);

    fireEvent.change(requireFieldInput(container, '_meta.ogTitle'), {
      target: { value: 'Launch recap' },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    const payload = lastPayload(onChange);
    const meta = (payload.root as { props: { _meta: Record<string, unknown> } }).props._meta;
    expect(meta.ogTitle).toBe('Launch recap');
    expect(meta._defs).toBe('admin-only value');
  });
});

describe('spike item 2 · can the Page tab be left stale, unresolved, or wrong?', () => {
  it('re-resolves the root when the Page tab clears the item selector', async () => {
    const { container } = renderPuck('editor', { itemSelector: { zone: ROOT_ZONE, index: 0 } });

    await waitFor(() => {
      expect(fieldInput(container, 'text')).not.toBeNull();
    });
    // With a block selected the root resolver has not run at all.
    expect(calls.filter((c) => c.resolver === 'root')).toHaveLength(0);

    // This is exactly what P1InspectorFields' Page tab dispatches.
    await act(async () => {
      getStore().getState().dispatch({ type: 'setUi', ui: { itemSelector: null } });
    });

    await waitForRootFields(container);
    expect(calls.filter((c) => c.resolver === 'root').length).toBeGreaterThan(0);
    expect(fieldInput(container, '_meta._defs')).toBeNull();
  });

  it("selects nothing when the zone is the bare 'default-zone' P1InspectorFields dispatches", async () => {
    const { container } = renderPuck('editor');
    await waitForRootFields(container);

    await act(async () => {
      getStore()
        .getState()
        .dispatch({ type: 'setUi', ui: { itemSelector: { zone: 'default-zone', index: 0 } } });
    });

    // getItem() looks up indexes.zones['default-zone'], which does not exist —
    // the zone key is 'root:default-zone'. Selection silently no-ops.
    expect(getStore().getState().selectedItem).toBeFalsy();
  });

  it('getComponentConfig falls back to the selected component when asked for the root', async () => {
    const { container } = renderPuck('editor');
    await waitForRootFields(container);

    const rootConfigWhenNothingSelected = getStore().getState().getComponentConfig(undefined);
    expect(Object.keys(rootConfigWhenNothingSelected?.fields ?? {})).toEqual(['title', '_meta']);

    await act(async () => {
      getStore()
        .getState()
        .dispatch({ type: 'setUi', ui: { itemSelector: { zone: ROOT_ZONE, index: 0 } } });
    });

    // The documented hazard: a root resolve started in this window would run
    // the Block resolver against root data.
    const rootConfigWhileSelected = getStore().getState().getComponentConfig(undefined);
    expect(Object.keys(rootConfigWhileSelected?.fields ?? {})).toEqual(['text']);
  });

  it('discards an in-flight root resolve when a block is selected mid-flight', async () => {
    const { container } = renderPuck('editor', { rootDelayMs: 150 });
    await waitForRootFields(container);

    calls = [];
    await act(async () => {
      // Mutate the root node to trigger a re-resolve, then select a block
      // before the slow resolver settles.
      getStore()
        .getState()
        .dispatch({ type: 'setData', data: { root: { props: { title: 'Changed' } } } });
      getStore()
        .getState()
        .dispatch({ type: 'setUi', ui: { itemSelector: { zone: ROOT_ZONE, index: 0 } } });
      await new Promise((r) => setTimeout(r, 300));
    });

    // Worst case is the block's own fields or an empty panel — never the root's
    // fields rendered under a block selection.
    const state = getStore().getState();
    expect(state.selectedItem?.props.id).toBe('block-1');
    expect(Object.keys(state.fields.fields)).not.toContain('_meta');

    // The getComponentConfig fallback would show up as the Block resolver being
    // handed root data. Recorded so a Puck upgrade that makes it reachable fails here.
    expect(calls.filter((c) => c.resolver === 'Block' && c.dataType === 'root')).toEqual([]);
  });

  it('does not re-resolve when only the metadata prop changes', async () => {
    const { container, rerender } = render(
      <Puck
        key="css-editor"
        config={makeConfig('editor') as never}
        data={BASE_DATA}
        iframe={{ enabled: false }}
        metadata={{ inheritedOgTitle: 'first' }}
      />,
    );
    await waitForRootFields(container);
    const before = calls.filter((c) => c.resolver === 'root').length;

    await act(async () => {
      rerender(
        <Puck
          key="css-editor"
          config={makeConfig('editor') as never}
          data={BASE_DATA}
          iframe={{ enabled: false }}
          metadata={{ inheritedOgTitle: 'second' }}
        />,
      );
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(calls.filter((c) => c.resolver === 'root').length).toBe(before);
  });
});

describe('spike item 3 · the persisted autosave payload stays clean', () => {
  it('carries no role-derived or inherited state into the snapshot', async () => {
    const onChange = vi.fn();
    const { container } = renderPuck('editor', {
      onChange,
      metadata: { inheritedOgTitle: 'Site default title', userRole: 'editor' },
    });
    await waitForRootFields(container);

    // The resolver does see the inherited value — it just must not persist it.
    await waitFor(() => {
      expect(calls.find((c) => c.resolver === 'root')?.metadata).toMatchObject({
        inheritedOgTitle: 'Site default title',
      });
    });

    fireEvent.change(requireFieldInput(container, '_meta.ogTitle'), {
      target: { value: 'Launch recap' },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    const payload = lastPayload(onChange);
    const root = payload.root as { props: Record<string, unknown>; readOnly?: unknown };

    expect(root).not.toHaveProperty('readOnly');
    expect(Object.keys(root.props)).not.toContain('_seo');
    expect(Object.keys(root.props)).not.toContain('userRole');
    expect(root.props._meta).not.toHaveProperty('inheritedOgTitle');
    expect(Object.keys(root.props).sort()).toEqual(['_meta', 'title']);
  });
});
