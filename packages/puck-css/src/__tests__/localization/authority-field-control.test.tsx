/**
 * Authority Field Control Tests
 *
 * Per-prop fields-panel controls. The break/reset inheritance control renders
 * only on a translation, and reflects the authority the server resolves: the
 * prop's override, then its slot's template default, then the site-wide
 * fallback. A move to the authority the slot already defaults to DELETEs the
 * override rather than storing one that repeats it. The translatability toggle
 * renders only on the canonical page, where the shared decision lives and the
 * map travels with the document's own content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

import type { P1PuckContextValue } from '../../core/types.js';
import { resolveFeatureConfig } from '../../core/featureConfig.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';

const { mockDispatch, puckData } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  puckData: { current: { content: [], root: { props: {} } } as Record<string, unknown> },
}));

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => (selector: (state: unknown) => unknown) =>
    selector({ appState: { data: puckData.current }, dispatch: mockDispatch }),
}));

import { AuthorityFieldControl } from '../../features/localization/ui/AuthorityFieldControl.js';

const translationDoc = {
  id: 'doc-fr',
  siteId: 'site-1',
  path: 'pages/home.fr-FR',
  archived: false,
  createdAt: '2026-07-13T00:00:00Z',
  updatedAt: '2026-07-13T00:00:00Z',
  locale: 'fr-FR',
  localizedFromId: 'doc-canonical',
};

const canonicalDoc = {
  id: 'doc-canonical',
  siteId: 'site-1',
  path: 'pages/home',
  archived: false,
  createdAt: '2026-07-13T00:00:00Z',
  updatedAt: '2026-07-13T00:00:00Z',
  localizedFromId: null,
};

function makeClient(initialMap: Record<string, Record<string, 'canonical' | 'locale'>> = {}) {
  return {
    translations: {
      getAuthorityOverrides: vi.fn().mockResolvedValue({ authorityOverrides: initialMap }),
      setAuthorityOverride: vi
        .fn()
        .mockResolvedValue({ authorityOverrides: { 'comp-1': { title: 'locale' } } }),
      clearAuthorityOverride: vi.fn().mockResolvedValue({ authorityOverrides: {} }),
    },
  };
}

/** The translatability map the editor holds for the open document. */
function editorHoldsTranslatable(map: Record<string, Record<string, boolean>>) {
  puckData.current = { content: [], root: { props: { _localeTranslatable: map } } };
}

/** The data the dispatched setData updater produces from the editor's data. */
function dispatchedData(): Record<string, unknown> {
  const action = mockDispatch.mock.calls[0][0] as {
    type: string;
    recordHistory?: boolean;
    data: (previous: unknown) => Record<string, unknown>;
  };
  expect(action.type).toBe('setData');
  expect(action.recordHistory).toBe(true);
  return action.data(puckData.current);
}

const addError = vi.fn();

function makeCtx(
  client: ReturnType<typeof makeClient>,
  currentDocument: unknown = translationDoc,
): P1PuckContextValue {
  return {
    client,
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument,
    documents: [canonicalDoc, translationDoc],
    featureConfig: resolveFeatureConfig({}),
    notifications: { addError },
  } as unknown as P1PuckContextValue;
}

const fieldProps = {
  name: 'title',
  id: 'comp-1_text_title',
  field: { type: 'text' as const },
  value: 'Bonjour',
  onChange: vi.fn(),
  children: <input data-testid="the-field" defaultValue="Bonjour" />,
};

function withQueryClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <P1SdkQueryClientContext.Provider value={client}>{node}</P1SdkQueryClientContext.Provider>
  );
}

function renderControl(ctx: P1PuckContextValue) {
  return render(
    withQueryClient(
      <P1PuckContext.Provider value={ctx}>
        <AuthorityFieldControl {...fieldProps} />
      </P1PuckContext.Provider>,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  puckData.current = { content: [], root: { props: {} } };
});

describe('AuthorityFieldControl gating', () => {
  it('shows no authority control and fetches no overrides on the canonical page', async () => {
    const client = makeClient();
    renderControl(makeCtx(client, canonicalDoc));

    expect(screen.getByTestId('the-field')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-break')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-reset')).not.toBeInTheDocument();
    await Promise.resolve();
    expect(client.translations.getAuthorityOverrides).not.toHaveBeenCalled();
  });

  it('treats a canonical page written in a locale as canonical', async () => {
    const client = makeClient();
    const localisedCanonical = { ...canonicalDoc, path: 'pages/home', locale: 'en-US' };
    renderControl(makeCtx(client, localisedCanonical));

    // A locale says which language the page is written in, not what it inherits.
    expect(await screen.findByTestId('loc-translatable-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-break')).not.toBeInTheDocument();
    expect(client.translations.getAuthorityOverrides).not.toHaveBeenCalled();
  });

  it('shows no translatability toggle on a translation', async () => {
    const client = makeClient();
    renderControl(makeCtx(client));

    expect(await screen.findByTestId('loc-authority-break')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-translatable-toggle')).not.toBeInTheDocument();
  });
});

describe('AuthorityFieldControl fetching', () => {
  function renderFields(ctx: P1PuckContextValue, names: string[]) {
    return render(
      withQueryClient(
        <P1PuckContext.Provider value={ctx}>
          {names.map((name) => (
            <AuthorityFieldControl
              key={name}
              {...fieldProps}
              name={name}
              id={`comp-1_text_${name}`}
            />
          ))}
        </P1PuckContext.Provider>,
      ),
    );
  }

  it('reads the override map once and answers every field from that one response', async () => {
    const client = makeClient({ 'comp-1': { subtitle: 'locale', caption: 'locale' } });
    renderFields(makeCtx(client), ['title', 'subtitle', 'body', 'caption']);

    // subtitle and caption are owned by the locale, title and body inherit —
    // four fields projected from a single fetch.
    await waitFor(() => expect(screen.getAllByTestId('loc-authority-reset')).toHaveLength(2));
    expect(screen.getAllByTestId('loc-authority-break')).toHaveLength(2);
    expect(client.translations.getAuthorityOverrides).toHaveBeenCalledTimes(1);
    expect(client.translations.getAuthorityOverrides).toHaveBeenCalledWith(
      'site-1',
      'branch-1',
      'doc-fr',
    );
  });

  it('answers every field from the editor\'s own data, without a request', async () => {
    editorHoldsTranslatable({ 'comp-1': { subtitle: false, caption: false } });
    const client = makeClient();
    renderFields(makeCtx(client, canonicalDoc), ['title', 'subtitle', 'body', 'caption']);

    await waitFor(() => expect(screen.getAllByTestId('loc-translatable-toggle')).toHaveLength(4));
    const toggles = screen.getAllByTestId('loc-translatable-toggle');
    expect(toggles.map((t) => (t as HTMLInputElement).checked)).toEqual([true, false, true, false]);
    expect(client.translations.getAuthorityOverrides).not.toHaveBeenCalled();
  });

  it('lands a write on the edited field only, without re-reading the document', async () => {
    const client = makeClient({});
    renderFields(makeCtx(client), ['title', 'subtitle']);

    await waitFor(() => expect(screen.getAllByTestId('loc-authority-break')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('loc-authority-break')[0] as HTMLElement);

    await waitFor(() =>
      expect(client.translations.setAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: 'comp-1', propName: 'title', authority: 'locale' },
      ),
    );
    expect(client.translations.setAuthorityOverride).toHaveBeenCalledTimes(1);

    // The write's own response carries the new map, so title flips to Reset,
    // subtitle stays inherited, and no field goes back to the server.
    await waitFor(() => expect(screen.getAllByTestId('loc-authority-reset')).toHaveLength(1));
    expect(screen.getAllByTestId('loc-authority-break')).toHaveLength(1);
    expect(client.translations.getAuthorityOverrides).toHaveBeenCalledTimes(1);
  });

  it('renders no control until the document answers, never a guessed authority', async () => {
    let settle: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    const client = makeClient({});
    client.translations.getAuthorityOverrides.mockReturnValue(pending);

    renderControl(makeCtx(client));

    expect(screen.getByTestId('the-field')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-break')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-reset')).not.toBeInTheDocument();

    settle({ authorityOverrides: { 'comp-1': { title: 'locale' } } });

    // The prop is locale-owned, so Reset is the first thing drawn — the control
    // never shows Inherited on the way there.
    expect(await screen.findByTestId('loc-authority-reset')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-break')).not.toBeInTheDocument();
  });

  it('offers no authority control when the override map cannot be read', async () => {
    const client = makeClient({});
    client.translations.getAuthorityOverrides.mockRejectedValue(new Error('upstream down'));

    renderControl(makeCtx(client));

    // Absent authority resolves every prop to inherited, so the control would
    // state something the server never said. The field itself still renders.
    await waitFor(() => expect(addError).toHaveBeenCalled());
    expect(screen.queryByTestId('loc-authority-break')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-reset')).not.toBeInTheDocument();
    expect(screen.getByTestId('the-field')).toBeInTheDocument();
  });
});

describe('AuthorityFieldControl on a translation', () => {
  it('fetches overrides for the translation and shows the break control when inherited', async () => {
    const client = makeClient({});
    renderControl(makeCtx(client));

    expect(await screen.findByTestId('loc-authority-break')).toBeInTheDocument();
    expect(client.translations.getAuthorityOverrides).toHaveBeenCalledWith(
      'site-1',
      'branch-1',
      'doc-fr',
    );
    expect(screen.getByTestId('the-field')).toBeInTheDocument();
  });

  it('breaks inheritance by PUTting authority locale for (slotId, propName)', async () => {
    const client = makeClient({});
    renderControl(makeCtx(client));

    fireEvent.click(await screen.findByTestId('loc-authority-break'));

    await waitFor(() =>
      expect(client.translations.setAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: 'comp-1', propName: 'title', authority: 'locale' },
      ),
    );
    // After breaking, the control reflects the broken state.
    expect(await screen.findByTestId('loc-authority-reset')).toBeInTheDocument();
  });

  it('shows the reset control when the prop authority is already locale', async () => {
    const client = makeClient({ 'comp-1': { title: 'locale' } });
    renderControl(makeCtx(client));

    expect(await screen.findByTestId('loc-authority-reset')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-break')).not.toBeInTheDocument();
  });

  it('resets inheritance by DELETEing the override', async () => {
    const client = makeClient({ 'comp-1': { title: 'locale' } });
    renderControl(makeCtx(client));

    fireEvent.click(await screen.findByTestId('loc-authority-reset'));

    await waitFor(() =>
      expect(client.translations.clearAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: 'comp-1', propName: 'title' },
      ),
    );
    expect(await screen.findByTestId('loc-authority-break')).toBeInTheDocument();
  });
});

describe('AuthorityFieldControl slot defaults', () => {
  function makeClientWithDefaults(
    slotDefaults: Record<string, 'canonical' | 'locale'>,
    defaultAuthority: 'canonical' | 'locale' = 'canonical',
    initialMap: Record<string, Record<string, 'canonical' | 'locale'>> = {},
  ) {
    const response = { authorityOverrides: initialMap, slotDefaults, defaultAuthority };
    return {
      translations: {
        getAuthorityOverrides: vi.fn().mockResolvedValue(response),
        setAuthorityOverride: vi.fn().mockResolvedValue(response),
        clearAuthorityOverride: vi.fn().mockResolvedValue(response),
      },
    };
  }

  it('treats a prop as owned when its slot default is locale and no override names it', async () => {
    const client = makeClientWithDefaults({ 'comp-1': 'locale' });
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>));

    expect(await screen.findByTestId('loc-authority-reset')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-break')).not.toBeInTheDocument();
  });

  it('lets an override name a prop canonical against a locale slot default', async () => {
    const client = makeClientWithDefaults({ 'comp-1': 'locale' }, 'canonical', {
      'comp-1': { title: 'canonical' },
    });
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>));

    expect(await screen.findByTestId('loc-authority-break')).toBeInTheDocument();
  });

  it('falls back to the site-wide authority for a slot the template does not declare', async () => {
    const client = makeClientWithDefaults({ 'comp-other': 'canonical' }, 'locale');
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>));

    expect(await screen.findByTestId('loc-authority-reset')).toBeInTheDocument();
  });

  it('stores an explicit canonical override to make a locale-default prop inherit', async () => {
    const client = makeClientWithDefaults({ 'comp-1': 'locale' });
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>));

    fireEvent.click(await screen.findByTestId('loc-authority-reset'));

    await waitFor(() =>
      expect(client.translations.setAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: 'comp-1', propName: 'title', authority: 'canonical' },
      ),
    );
    expect(client.translations.clearAuthorityOverride).not.toHaveBeenCalled();
  });

  it('drops the override instead of storing one that repeats the slot default', async () => {
    const client = makeClientWithDefaults({ 'comp-1': 'locale' }, 'canonical', {
      'comp-1': { title: 'canonical' },
    });
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>));

    fireEvent.click(await screen.findByTestId('loc-authority-break'));

    await waitFor(() =>
      expect(client.translations.clearAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: 'comp-1', propName: 'title' },
      ),
    );
    expect(client.translations.setAuthorityOverride).not.toHaveBeenCalled();
  });

  it('reads a prop named like an Object prototype member as inherited', async () => {
    const client = makeClientWithDefaults({}, 'canonical', { 'comp-1': {} });
    render(
      withQueryClient(
        <P1PuckContext.Provider value={makeCtx(client as unknown as ReturnType<typeof makeClient>)}>
          <AuthorityFieldControl
            {...fieldProps}
            name="constructor"
            id="comp-1_text_constructor"
          />
        </P1PuckContext.Provider>,
      ),
    );

    expect(await screen.findByTestId('loc-authority-break')).toBeInTheDocument();
  });
});

describe('AuthorityFieldControl translatability toggle', () => {
  it('renders the toggle defaulted on when nothing is stored', async () => {
    const client = makeClient({});
    renderControl(makeCtx(client, canonicalDoc));

    expect(await screen.findByTestId('loc-translatable-toggle')).toBeChecked();
  });

  it('reflects a stored false in the editor\'s data', async () => {
    editorHoldsTranslatable({ 'comp-1': { title: false } });
    renderControl(makeCtx(makeClient(), canonicalDoc));

    await waitFor(() => expect(screen.getByTestId('loc-translatable-toggle')).not.toBeChecked());
  });

  it('sets _localeTranslatable in the editor\'s data when toggled off', async () => {
    puckData.current = { content: [], root: { props: { title: 'Home' } } };
    renderControl(makeCtx(makeClient(), canonicalDoc));

    fireEvent.click(await screen.findByTestId('loc-translatable-toggle'));

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const next = dispatchedData();
    const props = (next.root as { props: Record<string, unknown> }).props;
    const map = props._localeTranslatable as Record<string, Record<string, boolean>>;
    expect(map['comp-1'].title).toBe(false);
    // The edit rides the document's own content, so the rest of it survives.
    expect(props.title).toBe('Home');
  });

  it('prunes the entry when toggled back on', async () => {
    editorHoldsTranslatable({ 'comp-1': { title: false } });
    renderControl(makeCtx(makeClient(), canonicalDoc));

    fireEvent.click(await screen.findByTestId('loc-translatable-toggle'));

    const next = dispatchedData();
    const map = (next.root as { props: Record<string, unknown> }).props
      ._localeTranslatable as Record<string, unknown> | undefined;
    expect(map?.['comp-1']).toBeUndefined();
  });
});

describe('AuthorityFieldControl field addressing', () => {
  function renderField(
    ctx: P1PuckContextValue,
    field: { id?: string; name: string; type?: string },
  ) {
    return render(
      withQueryClient(
        <P1PuckContext.Provider value={ctx}>
          <AuthorityFieldControl
            {...fieldProps}
            id={field.id}
            name={field.name}
            field={{ type: field.type ?? 'text' }}
          />
        </P1PuckContext.Provider>,
      ),
    );
  }

  /** A top-level field beside a nested one, so an absent control is not just an unsettled one. */
  function renderPair(ctx: P1PuckContextValue, nested: { id: string; name: string }) {
    return render(
      withQueryClient(
        <P1PuckContext.Provider value={ctx}>
          <AuthorityFieldControl {...fieldProps} />
          <AuthorityFieldControl {...fieldProps} id={nested.id} name={nested.name} />
        </P1PuckContext.Provider>,
      ),
    );
  }

  it('carries no authority control on a subfield of an object prop', async () => {
    renderPair(makeCtx(makeClient()), { id: 'comp-1_object_meta_title', name: 'meta.title' });

    // The top-level field draws its control; the subfield beside it draws none.
    expect(await screen.findByTestId('loc-authority-break')).toBeInTheDocument();
    expect(screen.getAllByTestId('loc-authority-break')).toHaveLength(1);
    expect(screen.getAllByTestId('the-field')).toHaveLength(2);
  });

  it('carries no toggle on a subfield of an array item', async () => {
    renderPair(makeCtx(makeClient(), canonicalDoc), {
      id: 'cards-1_array_items_title',
      name: 'items[0].title',
    });

    expect(await screen.findByTestId('loc-translatable-toggle')).toBeInTheDocument();
    expect(screen.getAllByTestId('loc-translatable-toggle')).toHaveLength(1);
    expect(screen.getAllByTestId('the-field')).toHaveLength(2);
  });

  it('keys a root prop by the root slot id when breaking inheritance', async () => {
    const client = makeClient();
    renderField(makeCtx(client), { id: 'root_text_title', name: 'title' });

    fireEvent.click(await screen.findByTestId('loc-authority-break'));

    await waitFor(() =>
      expect(client.translations.setAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: '__root__', propName: 'title', authority: 'locale' },
      ),
    );
  });

  it('keys a root prop by the root slot id when marking it untranslatable', async () => {
    renderField(makeCtx(makeClient(), canonicalDoc), { id: 'root_text_title', name: 'title' });

    fireEvent.click(await screen.findByTestId('loc-translatable-toggle'));

    const next = dispatchedData();
    const map = (next.root as { props: Record<string, unknown> }).props
      ._localeTranslatable as Record<string, Record<string, boolean>>;
    expect(map.__root__.title).toBe(false);
  });

  it('reads a root prop override stored under the root slot id', async () => {
    const client = makeClient({ __root__: { title: 'locale' } });
    renderField(makeCtx(client), { id: 'root_text_title', name: 'title' });

    expect(await screen.findByTestId('loc-authority-reset')).toBeInTheDocument();
  });
});

describe('AuthorityFieldControl read failures', () => {
  it('reports a failed authority read, naming the reason', async () => {
    const client = makeClient();
    client.translations.getAuthorityOverrides.mockRejectedValue(new Error('gateway timeout'));
    renderControl(makeCtx(client));

    await waitFor(() => expect(addError).toHaveBeenCalledTimes(1));
    expect(addError.mock.calls[0][0]).toContain('gateway timeout');
  });
});

describe('AuthorityFieldControl write failures', () => {
  it('reports a rejected authority write, naming the reason', async () => {
    const client = makeClient({});
    client.translations.setAuthorityOverride.mockRejectedValue(new Error('branch is read-only'));
    renderControl(makeCtx(client));

    fireEvent.click(await screen.findByTestId('loc-authority-break'));

    await waitFor(() => expect(addError).toHaveBeenCalledTimes(1));
    expect(addError.mock.calls[0][0]).toContain('branch is read-only');
  });
});
