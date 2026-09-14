/**
 * Translation Glyph Tests
 *
 * The per-prop localization control, reached from the glyph in a field's label
 * row. The glyph marks a prop that has left its default and opens the setting
 * that governs it: authority on a translation, where the control reflects the
 * authority the server resolves (the prop's override, then its slot's template
 * default, then the site-wide fallback) and a move to the authority the slot
 * already defaults to DELETEs the override rather than storing one that repeats
 * it; translatability on the canonical page, where the shared decision lives and
 * the map travels with the document's own content.
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

vi.mock('@puckeditor/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@puckeditor/core');
  return {
    ...actual,
    createUsePuck: () => (selector: (state: unknown) => unknown) =>
      selector({ appState: { data: puckData.current }, dispatch: mockDispatch }),
  };
});

import { LocalizationField } from '../../features/localization/ui/LocalizationField.js';
import { P1FieldLabel } from '../../editor/plugin/createP1Overrides.js';

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

function makeClient(
  initialMap: Record<string, Record<string, 'canonical' | 'locale'>> = {},
  markets: string[] = ['fr-FR'],
) {
  return {
    sites: {
      getSettings: vi.fn().mockResolvedValue({ settings: { locales: { markets } } }),
    },
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
};

/** One field as the panel composes it: the field override around its label row. */
function field(props: Partial<typeof fieldProps> & { readOnly?: boolean } = {}) {
  const { readOnly, ...rest } = props;
  const merged = { ...fieldProps, ...rest };
  return (
    <LocalizationField key={merged.id} {...merged}>
      <P1FieldLabel label="Title" readOnly={readOnly}>
        <input data-testid="the-field" defaultValue="Bonjour" />
      </P1FieldLabel>
    </LocalizationField>
  );
}

function withQueryClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <P1SdkQueryClientContext.Provider value={client}>{node}</P1SdkQueryClientContext.Provider>
  );
}

function renderFields(ctx: P1PuckContextValue, fields: React.ReactNode) {
  return render(
    withQueryClient(<P1PuckContext.Provider value={ctx}>{fields}</P1PuckContext.Provider>),
  );
}

function renderControl(ctx: P1PuckContextValue, props?: Parameters<typeof field>[0]) {
  return renderFields(ctx, field(props));
}

/** Open the one field's settings, waiting for its glyph to be offered. */
async function openSettings(): Promise<void> {
  fireEvent.click(await screen.findByTestId('loc-translation-glyph'));
}

/** Whether each rendered glyph marks its prop as having left its default. */
function divergedFlags(): string[] {
  return screen
    .getAllByTestId('loc-translation-glyph')
    .map((glyph) => glyph.getAttribute('data-diverged') ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  puckData.current = { content: [], root: { props: {} } };
});

describe('TranslationGlyph gating', () => {
  it('offers translatability and no authority control on the canonical page', async () => {
    const client = makeClient();
    renderControl(makeCtx(client, canonicalDoc));

    expect(screen.getByTestId('the-field')).toBeInTheDocument();
    await openSettings();
    expect(screen.getByTestId('loc-translatable-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-toggle')).not.toBeInTheDocument();
    await Promise.resolve();
    expect(client.translations.getAuthorityOverrides).not.toHaveBeenCalled();
  });

  it('treats a canonical page written in a locale as canonical', async () => {
    const client = makeClient();
    const localisedCanonical = { ...canonicalDoc, path: 'pages/home', locale: 'en-US' };
    renderControl(makeCtx(client, localisedCanonical));

    // A locale says which language the page is written in, not what it inherits.
    await openSettings();
    expect(screen.getByTestId('loc-translatable-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-authority-toggle')).not.toBeInTheDocument();
    expect(client.translations.getAuthorityOverrides).not.toHaveBeenCalled();
  });

  it('offers authority and no translatability control on a translation', async () => {
    const client = makeClient();
    renderControl(makeCtx(client));

    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-translatable-toggle')).not.toBeInTheDocument();
  });

  it('renders no glyph on a document that is neither', async () => {
    renderControl(makeCtx(makeClient(), null));

    expect(screen.getByTestId('the-field')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-translation-glyph')).not.toBeInTheDocument();
  });

  it('renders no glyph on a site that publishes into no locale', async () => {
    renderControl(makeCtx(makeClient({}, []), canonicalDoc));

    expect(await screen.findByTestId('the-field')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-translation-glyph')).not.toBeInTheDocument();
  });

  it("renders no glyph until the site's locales answer", async () => {
    const client = makeClient();
    client.sites.getSettings.mockReturnValue(new Promise(() => {}));
    renderControl(makeCtx(client, canonicalDoc));

    expect(screen.getByTestId('the-field')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-translation-glyph')).not.toBeInTheDocument();
  });

  it('keeps the glyph when the locales cannot be read', async () => {
    const client = makeClient();
    client.sites.getSettings.mockRejectedValue(new Error('settings unreachable'));
    renderControl(makeCtx(client, canonicalDoc));

    // A read that failed says nothing about the site, so withholding the
    // control would report "no locales" on the strength of an outage.
    expect(await screen.findByTestId('loc-translation-glyph')).toBeInTheDocument();
  });

  it('leaves a click inside the settings free to act on the control it hit', async () => {
    renderControl(makeCtx(makeClient(), canonicalDoc));
    await openSettings();

    // A switch's caption is a <label>, which reaches its input through the
    // click's default behaviour — cancelling that leaves the caption dead.
    const toggle = screen.getByTestId('loc-translatable-toggle');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(toggle, click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('disables the setting on a read-only field', async () => {
    renderControl(makeCtx(makeClient(), canonicalDoc), { readOnly: true });

    await openSettings();
    expect(screen.getByTestId('loc-translatable-toggle')).toBeDisabled();
  });
});

describe('TranslationGlyph marking', () => {
  it('marks a locale-owned prop and leaves an inherited one unmarked', async () => {
    const client = makeClient({ 'comp-1': { subtitle: 'locale' } });
    renderFields(
      makeCtx(client),
      ['title', 'subtitle'].map((name) => field({ name, id: `comp-1_text_${name}` })),
    );

    await waitFor(() => expect(divergedFlags()).toEqual(['false', 'true']));
  });

  it('marks a prop the canonical page holds as not translated', async () => {
    editorHoldsTranslatable({ 'comp-1': { subtitle: false } });
    renderFields(
      makeCtx(makeClient(), canonicalDoc),
      ['title', 'subtitle'].map((name) => field({ name, id: `comp-1_text_${name}` })),
    );

    await waitFor(() => expect(divergedFlags()).toEqual(['false', 'true']));
  });
});

describe('TranslationGlyph fetching', () => {
  it('reads the override map once and answers every field from that one response', async () => {
    const client = makeClient({ 'comp-1': { subtitle: 'locale', caption: 'locale' } });
    renderFields(
      makeCtx(client),
      ['title', 'subtitle', 'body', 'caption'].map((name) =>
        field({ name, id: `comp-1_text_${name}` }),
      ),
    );

    // subtitle and caption are owned by the locale, title and body inherit —
    // four fields projected from a single fetch.
    await waitFor(() => expect(divergedFlags()).toEqual(['false', 'true', 'false', 'true']));
    expect(client.translations.getAuthorityOverrides).toHaveBeenCalledTimes(1);
    expect(client.translations.getAuthorityOverrides).toHaveBeenCalledWith(
      'site-1',
      'branch-1',
      'doc-fr',
    );
  });

  it("answers every field from the editor's own data, without a request", async () => {
    editorHoldsTranslatable({ 'comp-1': { subtitle: false, caption: false } });
    const client = makeClient();
    renderFields(
      makeCtx(client, canonicalDoc),
      ['title', 'subtitle', 'body', 'caption'].map((name) =>
        field({ name, id: `comp-1_text_${name}` }),
      ),
    );

    await waitFor(() => expect(divergedFlags()).toEqual(['false', 'true', 'false', 'true']));
    expect(client.translations.getAuthorityOverrides).not.toHaveBeenCalled();
  });

  it('lands a write on the edited field only, without re-reading the document', async () => {
    const client = makeClient({});
    renderFields(
      makeCtx(client),
      ['title', 'subtitle'].map((name) => field({ name, id: `comp-1_text_${name}` })),
    );

    await waitFor(() => expect(divergedFlags()).toEqual(['false', 'false']));
    fireEvent.click(screen.getAllByTestId('loc-translation-glyph')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));

    await waitFor(() =>
      expect(client.translations.setAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: 'comp-1', propName: 'title', authority: 'locale' },
      ),
    );
    expect(client.translations.setAuthorityOverride).toHaveBeenCalledTimes(1);

    // The write's own response carries the new map, so title is marked,
    // subtitle stays inherited, and no field goes back to the server.
    await waitFor(() => expect(divergedFlags()).toEqual(['true', 'false']));
    expect(client.translations.getAuthorityOverrides).toHaveBeenCalledTimes(1);
  });

  it('renders no glyph until the document answers, never a guessed authority', async () => {
    let settle: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    const client = makeClient({});
    client.translations.getAuthorityOverrides.mockReturnValue(pending);

    renderControl(makeCtx(client));

    expect(screen.getByTestId('the-field')).toBeInTheDocument();
    expect(screen.queryByTestId('loc-translation-glyph')).not.toBeInTheDocument();

    settle({ authorityOverrides: { 'comp-1': { title: 'locale' } } });

    // The prop is locale-owned, so a marked glyph is the first thing drawn —
    // the field is never marked inherited on the way there.
    await waitFor(() => expect(divergedFlags()).toEqual(['true']));
    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).toBeChecked();
  });

  it('offers no glyph when the override map cannot be read', async () => {
    const client = makeClient({});
    client.translations.getAuthorityOverrides.mockRejectedValue(new Error('upstream down'));

    renderControl(makeCtx(client));

    // Absent authority resolves every prop to inherited, so the glyph would
    // state something the server never said. The field itself still renders.
    await waitFor(() => expect(addError).toHaveBeenCalled());
    expect(screen.queryByTestId('loc-translation-glyph')).not.toBeInTheDocument();
    expect(screen.getByTestId('the-field')).toBeInTheDocument();
  });
});

describe('TranslationGlyph on a translation', () => {
  it('fetches overrides for the translation and reads inherited when nothing owns the prop', async () => {
    const client = makeClient({});
    renderControl(makeCtx(client));

    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).not.toBeChecked();
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

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));

    await waitFor(() =>
      expect(client.translations.setAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: 'comp-1', propName: 'title', authority: 'locale' },
      ),
    );
    // After breaking, the control reflects the broken state.
    await waitFor(() => expect(screen.getByTestId('loc-authority-toggle')).toBeChecked());
  });

  it('reads owned when the prop authority is already locale', async () => {
    const client = makeClient({ 'comp-1': { title: 'locale' } });
    renderControl(makeCtx(client));

    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).toBeChecked();
  });

  it('resets inheritance by DELETEing the override', async () => {
    const client = makeClient({ 'comp-1': { title: 'locale' } });
    renderControl(makeCtx(client));

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));

    await waitFor(() =>
      expect(client.translations.clearAuthorityOverride).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        { slotId: 'comp-1', propName: 'title' },
      ),
    );
    await waitFor(() => expect(screen.getByTestId('loc-authority-toggle')).not.toBeChecked());
  });
});

describe('TranslationGlyph slot defaults', () => {
  function makeClientWithDefaults(
    slotDefaults: Record<string, 'canonical' | 'locale'>,
    defaultAuthority: 'canonical' | 'locale' = 'canonical',
    initialMap: Record<string, Record<string, 'canonical' | 'locale'>> = {},
  ) {
    const response = { authorityOverrides: initialMap, slotDefaults, defaultAuthority };
    return {
      sites: {
        getSettings: vi.fn().mockResolvedValue({ settings: { locales: { markets: ['fr-FR'] } } }),
      },
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

    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).toBeChecked();
  });

  it('lets an override name a prop canonical against a locale slot default', async () => {
    const client = makeClientWithDefaults({ 'comp-1': 'locale' }, 'canonical', {
      'comp-1': { title: 'canonical' },
    });
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>));

    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).not.toBeChecked();
  });

  it('falls back to the site-wide authority for a slot the template does not declare', async () => {
    const client = makeClientWithDefaults({ 'comp-other': 'canonical' }, 'locale');
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>));

    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).toBeChecked();
  });

  it('stores an explicit canonical override to make a locale-default prop inherit', async () => {
    const client = makeClientWithDefaults({ 'comp-1': 'locale' });
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>));

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));

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

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));

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
    renderControl(makeCtx(client as unknown as ReturnType<typeof makeClient>), {
      name: 'constructor',
      id: 'comp-1_text_constructor',
    });

    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).not.toBeChecked();
  });
});

describe('TranslationGlyph translatability toggle', () => {
  it('renders the toggle defaulted on when nothing is stored', async () => {
    const client = makeClient({});
    renderControl(makeCtx(client, canonicalDoc));

    await openSettings();
    expect(screen.getByTestId('loc-translatable-toggle')).toBeChecked();
  });

  it("reflects a stored false in the editor's data", async () => {
    editorHoldsTranslatable({ 'comp-1': { title: false } });
    renderControl(makeCtx(makeClient(), canonicalDoc));

    await openSettings();
    expect(screen.getByTestId('loc-translatable-toggle')).not.toBeChecked();
  });

  it("sets _localeTranslatable in the editor's data when toggled off", async () => {
    puckData.current = { content: [], root: { props: { title: 'Home' } } };
    renderControl(makeCtx(makeClient(), canonicalDoc));

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-translatable-toggle'));

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

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-translatable-toggle'));

    const next = dispatchedData();
    const map = (next.root as { props: Record<string, unknown> }).props
      ._localeTranslatable as Record<string, unknown> | undefined;
    expect(map?.['comp-1']).toBeUndefined();
  });
});

describe('TranslationGlyph field addressing', () => {
  /** A top-level field beside a nested one, so an absent glyph is not just an unsettled one. */
  function renderPair(ctx: P1PuckContextValue, nested: { id: string; name: string }) {
    return renderFields(ctx, [field(), field(nested)]);
  }

  it('carries no glyph on a subfield of an object prop', async () => {
    renderPair(makeCtx(makeClient()), { id: 'comp-1_object_meta_title', name: 'meta.title' });

    // The top-level field draws its glyph; the subfield beside it draws none.
    await waitFor(() => expect(screen.getAllByTestId('loc-translation-glyph')).toHaveLength(1));
    expect(screen.getAllByTestId('the-field')).toHaveLength(2);
  });

  it('carries no glyph on a subfield of an array item', async () => {
    renderPair(makeCtx(makeClient(), canonicalDoc), {
      id: 'cards-1_array_items_title',
      name: 'items[0].title',
    });

    await waitFor(() => expect(screen.getAllByTestId('loc-translation-glyph')).toHaveLength(1));
    expect(screen.getAllByTestId('the-field')).toHaveLength(2);
  });

  it('keys a root prop by the root slot id when breaking inheritance', async () => {
    const client = makeClient();
    renderControl(makeCtx(client), { id: 'root_text_title', name: 'title' });

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));

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
    renderControl(makeCtx(makeClient(), canonicalDoc), { id: 'root_text_title', name: 'title' });

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-translatable-toggle'));

    const next = dispatchedData();
    const map = (next.root as { props: Record<string, unknown> }).props
      ._localeTranslatable as Record<string, Record<string, boolean>>;
    expect(map.__root__.title).toBe(false);
  });

  it('reads a root prop override stored under the root slot id', async () => {
    const client = makeClient({ __root__: { title: 'locale' } });
    renderControl(makeCtx(client), { id: 'root_text_title', name: 'title' });

    await openSettings();
    expect(screen.getByTestId('loc-authority-toggle')).toBeChecked();
  });
});

describe('TranslationGlyph read failures', () => {
  it('reports a failed authority read, naming the reason', async () => {
    const client = makeClient();
    client.translations.getAuthorityOverrides.mockRejectedValue(new Error('gateway timeout'));
    renderControl(makeCtx(client));

    await waitFor(() => expect(addError).toHaveBeenCalledTimes(1));
    expect(addError.mock.calls[0][0]).toContain('gateway timeout');
  });
});

describe('TranslationGlyph write failures', () => {
  it('reports a rejected authority write, naming the reason', async () => {
    const client = makeClient({});
    client.translations.setAuthorityOverride.mockRejectedValue(new Error('branch is read-only'));
    renderControl(makeCtx(client));

    await openSettings();
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));

    await waitFor(() => expect(addError).toHaveBeenCalledTimes(1));
    expect(addError.mock.calls[0][0]).toContain('branch is read-only');
  });
});
