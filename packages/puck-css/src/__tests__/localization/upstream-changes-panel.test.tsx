/**
 * Upstream Changes Panel tests
 *
 * A single relation-agnostic reconcile list. It fetches a classified
 * ChangeSummary for the current document's upstream edge (localization or
 * template), groups the changes, and renders each with the control appropriate
 * to its classification. Reconciliation flows through the editor's setData
 * dispatch; the list renders nothing unless the current document derives from
 * something along the edge being asked about.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { QueryClient } from '@tanstack/react-query';

import type { P1PuckContextValue } from '../../core/types.js';
import { resolveFeatureConfig } from '../../core/featureConfig.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';

const { mockDispatch, puckData } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  puckData: {
    current: {
      content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', spacing: 8 } }],
      root: { props: {} },
      zones: {},
    } as Record<string, unknown>,
  },
}));

vi.mock('@puckeditor/core', () => ({
  usePuck: () => ({ dispatch: mockDispatch, refreshPermissions: vi.fn() }),
  createUsePuck: () => (selector: (s: unknown) => unknown) =>
    selector({ dispatch: mockDispatch, selectedItem: null, config: {} }),
  useGetPuck: () => () => ({ appState: { data: puckData.current } }),
}));

import { UpstreamChangesPanel } from '../../features/localization/ui/UpstreamChangesPanel.js';

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

const templatePageDoc = {
  id: 'doc-page',
  siteId: 'site-1',
  path: 'pages/about',
  archived: false,
  createdAt: '2026-07-13T00:00:00Z',
  updatedAt: '2026-07-13T00:00:00Z',
  templateId: 'tpl-1',
  templateVersion: 2,
  localizedFromId: null,
};

function localizationSummary() {
  return {
    relationType: 'localization',
    derivedDocumentId: 'doc-fr',
    upstreamDocumentId: 'doc-canonical',
    fromVersion: 3,
    toVersion: 5,
    slotDelta: {},
    changes: [
      {
        classification: 'needsTranslation',
        componentId: 'HeadingBlock-1',
        propPath: '/title',
        upstreamOldValue: 'Hello',
        upstreamNewValue: 'Hello there',
        documentValue: 'Bonjour',
        translatable: true,
        authority: 'canonical',
      },
      {
        classification: 'autoApplied',
        componentId: 'HeadingBlock-1',
        propPath: '/spacing',
        upstreamOldValue: 8,
        upstreamNewValue: 12,
        documentValue: 8,
      },
      {
        classification: 'advisory',
        componentId: '__root__',
        propPath: '/title',
        upstreamOldValue: 'Home',
        upstreamNewValue: 'Homepage',
        documentValue: 'Accueil',
      },
      {
        classification: 'structural',
        componentId: 'CardBlock-2',
        structuralKind: 'added',
      },
    ],
    counts: { structural: 1, prop: 0, advisory: 1, needsTranslation: 1, autoApplied: 1 },
    resolvedCount: 0,
  };
}

interface MockChange {
  componentId: string;
  propPath?: string;
}

/**
 * A client whose diff reflects the resolutions recorded through it, which is the
 * backend's contract: a change stops being reported once its resolution is
 * recorded, per document.
 */
function makeClient(summary: unknown) {
  const recorded = new Map<string, Set<string>>();
  const target = (componentId: string, propPath?: string) => `${componentId}:${propPath ?? ''}`;

  return {
    relations: {
      getUpstreamDiff: vi.fn((_siteId: string, _branchId: string, documentId: string) => {
        const settled = recorded.get(documentId) ?? new Set<string>();
        const base = summary as { changes?: MockChange[] };
        return Promise.resolve({
          ...base,
          changes: (base.changes ?? []).filter(
            (change) => !settled.has(target(change.componentId, change.propPath)),
          ),
        });
      }),
      setUpstreamResolutions: vi.fn(
        (
          _siteId: string,
          _branchId: string,
          documentId: string,
          targets: { slotId: string; propPath: string }[],
          _upstreamVersion: number,
        ) => {
          const settled = recorded.get(documentId) ?? new Set<string>();
          for (const each of targets) {
            settled.add(target(each.slotId, each.propPath));
          }
          recorded.set(documentId, settled);
          return Promise.resolve({ upstreamResolutions: {} });
        },
      ),
    },
  };
}

const addError = vi.fn();

function makeCtx(
  client: unknown,
  currentDocument: unknown = translationDoc,
): P1PuckContextValue {
  return {
    client,
    notifications: { addError },
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument,
    documents: [translationDoc],
    featureConfig: resolveFeatureConfig({}),
  } as unknown as P1PuckContextValue;
}

function panelTree(
  queryClient: QueryClient,
  ctx: P1PuckContextValue,
  relationType: 'localization' | 'template',
) {
  return (
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={ctx}>
        <UpstreamChangesPanel relationType={relationType} />
      </P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>
  );
}

function renderPanel(
  ctx: P1PuckContextValue,
  relationType: 'localization' | 'template' = 'localization',
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(panelTree(queryClient, ctx, relationType));
  return {
    ...result,
    queryClient,
    rerenderPanel: (nextCtx: P1PuckContextValue) =>
      result.rerender(panelTree(queryClient, nextCtx, relationType)),
  };
}

/** The document the editor holds, which is what an apply is computed against. */
function editorHolds(content: { type: string; props: Record<string, unknown> }[]) {
  puckData.current = { content, root: { props: {} }, zones: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  editorHolds([{ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', spacing: 8 } }]);
});

describe('UpstreamChangesPanel gating', () => {
  it('renders nothing, without fetching, when the document is not a translation', async () => {
    const client = makeClient(localizationSummary());
    const canonicalDoc = {
      ...translationDoc,
      id: 'doc-canonical',
      path: 'pages/home',
      localizedFromId: null,
    };
    const { container } = renderPanel(makeCtx(client, canonicalDoc));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(client.relations.getUpstreamDiff).not.toHaveBeenCalled();
  });
});

describe('UpstreamChangesPanel gating on a localised canonical', () => {
  it('renders nothing for a canonical page written in a locale', async () => {
    const client = makeClient(localizationSummary());
    const localisedCanonical = {
      ...translationDoc,
      id: 'doc-en',
      path: 'pages/home',
      locale: 'en-US',
      localizedFromId: null,
    };
    const { container } = renderPanel(makeCtx(client, localisedCanonical));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(client.relations.getUpstreamDiff).not.toHaveBeenCalled();
  });
});

describe('UpstreamChangesPanel summary', () => {
  it('fetches the localization edge and counts the changes in each classification', async () => {
    const client = makeClient(localizationSummary());
    renderPanel(makeCtx(client));

    expect(await screen.findByTestId('upstream-count-needsTranslation')).toHaveTextContent('1');
    expect(screen.getByTestId('upstream-count-autoApplied')).toHaveTextContent('1');
    expect(screen.getByTestId('upstream-count-advisory')).toHaveTextContent('1');
    expect(screen.getByTestId('upstream-count-structural')).toHaveTextContent('1');

    expect(client.relations.getUpstreamDiff).toHaveBeenCalledWith(
      'site-1',
      'branch-1',
      'doc-fr',
      'localization',
    );
  });

  it('groups changes by classification', async () => {
    const client = makeClient(localizationSummary());
    renderPanel(makeCtx(client));

    expect(await screen.findByTestId('upstream-group-needsTranslation')).toBeInTheDocument();
    expect(screen.getByTestId('upstream-group-autoApplied')).toBeInTheDocument();
    expect(screen.getByTestId('upstream-group-advisory')).toBeInTheDocument();
    expect(screen.getByTestId('upstream-group-structural')).toBeInTheDocument();
  });
});

describe('UpstreamChangesPanel prop rendering', () => {
  it('sets each value beside the other, the upstream against this page', async () => {
    const summary = {
      ...localizationSummary(),
      changes: [
        {
          classification: 'needsTranslation',
          componentId: 'HeadingBlock-1',
          propPath: '/title',
          upstreamOldValue: 'Hello',
          upstreamNewValue: 'Hello there',
          documentValue: 'Bonjour',
          translatable: true,
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 1, autoApplied: 0 },
    };
    const client = makeClient(summary);
    renderPanel(makeCtx(client));

    await screen.findByTestId('upstream-group-needsTranslation');

    expect(screen.getByTestId('upstream-new-value')).toHaveTextContent('Hello there');
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Bonjour');
  });

  it("tags this page's value with the language it is written in", async () => {
    const client = makeClient(localizationSummary());
    renderPanel(makeCtx(client));

    await screen.findByTestId('upstream-group-needsTranslation');

    // A value in another language needs its own direction and language, or it is
    // laid out and read as though it were in the page's.
    const value = screen.getAllByTestId('upstream-current-value')[0];
    expect(value).toHaveAttribute('lang', 'fr-FR');
    expect(value).toHaveAttribute('dir', 'ltr');
  });

  it("marks a right-to-left value's direction", async () => {
    const client = makeClient(localizationSummary());
    const arabic = { ...translationDoc, id: 'doc-ar', locale: 'ar-AE' };
    renderPanel(makeCtx(client, arabic));

    await screen.findByTestId('upstream-group-needsTranslation');

    const value = screen.getAllByTestId('upstream-current-value')[0];
    expect(value).toHaveAttribute('dir', 'rtl');
    expect(value).toHaveAttribute('lang', 'ar-AE');
  });
});

describe('UpstreamChangesPanel apply actions', () => {
  it('applies an autoApplied change through the editor setData dispatch', async () => {
    const summary = {
      ...localizationSummary(),
      changes: [
        {
          classification: 'autoApplied',
          componentId: 'HeadingBlock-1',
          propPath: '/spacing',
          upstreamOldValue: 8,
          upstreamNewValue: 12,
          documentValue: 8,
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 1 },
    };
    const client = makeClient(summary);
    renderPanel(makeCtx(client));

    fireEvent.click(await screen.findByTestId('upstream-apply'));

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
    const action = mockDispatch.mock.calls[0][0] as {
      type: string;
      recordHistory?: boolean;
      data: (previous: unknown) => { content: { props: Record<string, unknown> }[] };
    };
    expect(action.type).toBe('setData');
    expect(action.data(puckData.current).content[0].props.spacing).toBe(12);
    // An apply overwrites the author's value, so it has to be undoable.
    expect(action.recordHistory).toBe(true);
  });

  it('writes the prop against the document the reducer is given, not the one read on click', async () => {
    const summary = {
      ...localizationSummary(),
      changes: [
        {
          classification: 'autoApplied',
          componentId: 'HeadingBlock-1',
          propPath: '/spacing',
          upstreamOldValue: 8,
          upstreamNewValue: 12,
          documentValue: 8,
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 1 },
    };
    renderPanel(makeCtx(makeClient(summary)));

    fireEvent.click(await screen.findByTestId('upstream-apply'));

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
    const { data } = mockDispatch.mock.calls[0][0] as {
      data: (previous: unknown) => { content: { props: Record<string, unknown> }[] };
    };

    // A collaborator's edit reaches the store between the click and the reducer
    // running.
    const concurrent = {
      content: [
        { type: 'HeadingBlock', props: { id: 'HeadingBlock-1', spacing: 8, title: 'Bonjour' } },
      ],
      root: { props: {} },
      zones: {},
    };

    const next = data(concurrent);
    expect(next.content[0].props.spacing).toBe(12);
    expect(next.content[0].props.title).toBe('Bonjour');
  });

  it('shows an advisory change with no canvas edit, and records the dismissal', async () => {
    const summary = {
      ...localizationSummary(),
      changes: [
        {
          classification: 'advisory',
          componentId: '__root__',
          propPath: '/title',
          upstreamOldValue: 'Home',
          upstreamNewValue: 'Homepage',
          documentValue: 'Accueil',
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 1, needsTranslation: 0, autoApplied: 0 },
    };
    const client = makeClient(summary);
    renderPanel(makeCtx(client));

    const group = await screen.findByTestId('upstream-group-advisory');
    // Advisory is owned by the page: no apply/reconcile write.
    expect(within(group).queryByTestId('upstream-apply')).not.toBeInTheDocument();

    fireEvent.click(within(group).getByTestId('upstream-dismiss'));

    // Dismissing settles the change without touching the page's content.
    expect(mockDispatch).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(client.relations.setUpstreamResolutions).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        [{ slotId: '__root__', propPath: '/title' }],
        5,
      ),
    );
    await waitFor(() => expect(screen.queryByText('Homepage')).not.toBeInTheDocument());
  });

  it('renders structural changes read-only with a note', async () => {
    const summary = {
      ...localizationSummary(),
      changes: [{ classification: 'structural', componentId: 'CardBlock-2', structuralKind: 'added' }],
      counts: { structural: 1, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 0 },
    };
    const client = makeClient(summary);
    renderPanel(makeCtx(client));

    const group = await screen.findByTestId('upstream-group-structural');
    expect(within(group).getByTestId('upstream-structural-note')).toBeInTheDocument();
    expect(within(group).queryByTestId('upstream-apply')).not.toBeInTheDocument();
  });
});

describe('UpstreamChangesPanel upstream detection', () => {
  it('renders nothing for a template relation on a page bound to no template', async () => {
    const client = makeClient(localizationSummary());
    const blankPage = { ...templatePageDoc, templateId: null, templateVersion: null };
    const { container } = renderPanel(makeCtx(client, blankPage), 'template');

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(client.relations.getUpstreamDiff).not.toHaveBeenCalled();
  });

  it('reads a template relation off the template binding, not the localization link', async () => {
    const client = makeClient({ ...localizationSummary(), relationType: 'template' });
    renderPanel(makeCtx(client, templatePageDoc), 'template');

    await waitFor(() => expect(client.relations.getUpstreamDiff).toHaveBeenCalled());
  });
});

describe('UpstreamChangesPanel relation-agnostic', () => {
  it('renders a template-relation summary through the same panel', async () => {
    const templateSummary = {
      relationType: 'template',
      derivedDocumentId: 'doc-page',
      upstreamDocumentId: 'doc-page',
      fromVersion: 1,
      toVersion: 2,
      slotDelta: {},
      changes: [
        {
          classification: 'prop',
          componentId: 'HeadingBlock-1',
          propPath: '/title',
          upstreamOldValue: 'Old',
          upstreamNewValue: 'New',
          documentValue: 'Old',
        },
        { classification: 'structural', componentId: 'CardBlock-9', structuralKind: 'removed' },
      ],
      counts: { structural: 1, prop: 1, advisory: 0, needsTranslation: 0, autoApplied: 0 },
    };
    const client = makeClient(templateSummary);
    renderPanel(makeCtx(client, templatePageDoc), 'template');

    expect(await screen.findByTestId('upstream-count-prop')).toHaveTextContent('1');
    expect(screen.getByTestId('upstream-count-structural')).toHaveTextContent('1');
    expect(screen.getByTestId('upstream-group-prop')).toBeInTheDocument();

    expect(client.relations.getUpstreamDiff).toHaveBeenCalledWith(
      'site-1',
      'branch-1',
      'doc-page',
      'template',
    );
  });
});

describe('UpstreamChangesPanel resolution bookkeeping', () => {
  it('stops checking when there is nothing to check against', () => {
    const client = makeClient(localizationSummary());
    const ctx = { ...makeCtx(client), client: undefined } as unknown as P1PuckContextValue;
    renderPanel(ctx);

    expect(screen.queryByText('Checking for upstream changes…')).not.toBeInTheDocument();
  });

  it('drops a classification once its changes are resolved', async () => {
    const client = makeClient(localizationSummary());
    renderPanel(makeCtx(client));

    expect(await screen.findByTestId('upstream-count-advisory')).toHaveTextContent('1');

    const group = screen.getByTestId('upstream-group-advisory');
    fireEvent.click(within(group).getByTestId('upstream-dismiss'));

    // The count is of what the list shows, so an emptied classification goes.
    await waitFor(() =>
      expect(screen.queryByTestId('upstream-group-advisory')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('upstream-count-needsTranslation')).toHaveTextContent('1');
  });

  it('does not carry a dismissal onto another document', async () => {
    const client = makeClient(localizationSummary());
    const { rerenderPanel } = renderPanel(makeCtx(client));

    const group = await screen.findByTestId('upstream-group-advisory');
    fireEvent.click(within(group).getByTestId('upstream-dismiss'));
    await waitFor(() => expect(screen.queryByText('Homepage')).not.toBeInTheDocument());

    const otherDoc = { ...translationDoc, id: 'doc-de', path: 'pages/home.de-DE', locale: 'de-DE' };
    rerenderPanel(makeCtx(client, otherDoc));

    // The same change on a different translation has not been dismissed.
    expect(await screen.findByText('Homepage')).toBeInTheDocument();
  });

  it('leaves a change outstanding when the document holds no such component', async () => {
    const summary = {
      ...localizationSummary(),
      changes: [
        {
          classification: 'autoApplied',
          componentId: 'HeadingBlock-1',
          propPath: '/spacing',
          upstreamOldValue: 8,
          upstreamNewValue: 12,
          documentValue: 8,
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 1 },
    };
    editorHolds([{ type: 'CardBlock', props: { id: 'CardBlock-7' } }]);
    const client = makeClient(summary);
    renderPanel(makeCtx(client));

    fireEvent.click(await screen.findByTestId('upstream-apply'));

    // Nothing was applied, so the change is still there to be dealt with.
    expect(mockDispatch).not.toHaveBeenCalled();
    // A button that does nothing has to say why.
    await waitFor(() => expect(addError).toHaveBeenCalledTimes(1));
    expect(addError.mock.calls[0][0]).toContain('HeadingBlock-1');
    expect(screen.getByTestId('upstream-group-autoApplied')).toBeInTheDocument();
    expect(screen.getByTestId('upstream-count-autoApplied')).toHaveTextContent('1');
  });
});

describe('UpstreamChangesPanel recorded resolutions', () => {
  function summaryWith(change: Record<string, unknown>) {
    return {
      ...localizationSummary(),
      changes: [change],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 1 },
    };
  }

  it('takes the change off the list while its resolution is still being recorded', async () => {
    const client = makeClient(
      summaryWith({
        classification: 'autoApplied',
        componentId: 'HeadingBlock-1',
        propPath: '/spacing',
        upstreamOldValue: 8,
        upstreamNewValue: 12,
        documentValue: 8,
      }),
    );
    let recordResolution = (): void => {};
    client.relations.setUpstreamResolutions.mockReturnValue(
      new Promise((resolve) => {
        recordResolution = () => resolve({ upstreamResolutions: {} });
      }),
    );
    renderPanel(makeCtx(client));

    fireEvent.click(await screen.findByTestId('upstream-apply'));

    // The write has not come back yet, so the list cannot be waiting on it.
    await waitFor(() =>
      expect(screen.queryByTestId('upstream-group-autoApplied')).not.toBeInTheDocument(),
    );
    recordResolution();
  });

  it('records the prop it applied, so the change is not offered again', async () => {
    const client = makeClient(
      summaryWith({
        classification: 'autoApplied',
        componentId: 'HeadingBlock-1',
        propPath: '/spacing',
        upstreamOldValue: 8,
        upstreamNewValue: 12,
        documentValue: 8,
      }),
    );
    renderPanel(makeCtx(client));

    fireEvent.click(await screen.findByTestId('upstream-apply'));

    await waitFor(() =>
      expect(client.relations.setUpstreamResolutions).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        [{ slotId: 'HeadingBlock-1', propPath: '/spacing' }],
        5,
      ),
    );
  });

  it('records the exact change it applied, leaving siblings on the same field alone', async () => {
    editorHolds([
      {
        type: 'HeadingBlock',
        props: { id: 'HeadingBlock-1', badge: { label: 'Old', color: 'red' } },
      },
    ]);
    const client = makeClient({
      ...localizationSummary(),
      changes: [
        {
          classification: 'autoApplied',
          componentId: 'HeadingBlock-1',
          propPath: '/badge/label',
          upstreamOldValue: 'Old',
          upstreamNewValue: 'New',
          documentValue: 'Old',
        },
        {
          classification: 'autoApplied',
          componentId: 'HeadingBlock-1',
          propPath: '/badge/color',
          upstreamOldValue: 'red',
          upstreamNewValue: 'blue',
          documentValue: 'red',
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 2 },
    });
    renderPanel(makeCtx(client));

    const group = await screen.findByTestId('upstream-group-autoApplied');
    fireEvent.click(within(group).getAllByTestId('upstream-apply')[0]);

    // Applying one row settles that row's change and nothing else on the field.
    await waitFor(() => expect(client.relations.setUpstreamResolutions).toHaveBeenCalledTimes(1));
    expect(client.relations.setUpstreamResolutions).toHaveBeenCalledWith(
      'site-1',
      'branch-1',
      'doc-fr',
      [{ slotId: 'HeadingBlock-1', propPath: '/badge/label' }],
      5,
    );
    // The sibling change is still there to act on.
    expect(within(group).getAllByTestId('upstream-apply')).toHaveLength(1);
  });

  it('leaves a change needing translation listed after seeding a draft', async () => {
    const client = makeClient({
      ...localizationSummary(),
      changes: [
        {
          classification: 'needsTranslation',
          componentId: 'HeadingBlock-1',
          propPath: '/spacing',
          upstreamOldValue: 8,
          upstreamNewValue: 12,
          documentValue: 8,
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 1, autoApplied: 0 },
    });
    renderPanel(makeCtx(client));

    fireEvent.click(await screen.findByTestId('upstream-apply-draft'));

    // The field now holds the canonical's wording and still wants translating, so
    // seeding the draft settles nothing.
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
    expect(client.relations.setUpstreamResolutions).not.toHaveBeenCalled();
    expect(screen.getByTestId('upstream-apply-draft')).toBeInTheDocument();
  });

  it('stops offering to seed a draft that is already in the field', async () => {
    const client = makeClient({
      ...localizationSummary(),
      changes: [
        {
          classification: 'needsTranslation',
          componentId: 'HeadingBlock-1',
          propPath: '/title',
          upstreamOldValue: 'Old',
          upstreamNewValue: "The snap you can't put down.",
          documentValue: 'Ne plus pouvoir s\u2019en passer.',
          translatable: true,
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 1, autoApplied: 0 },
    });
    renderPanel(makeCtx(client));

    fireEvent.click(await screen.findByTestId('upstream-apply-draft'));

    // A second press would write the canonical wording over the translation that
    // has been typed since.
    await waitFor(() => expect(screen.getByTestId('upstream-apply-draft')).toBeDisabled());
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    // Marking it done stays available, so the row can still be settled.
    expect(screen.getByTestId('upstream-mark-done')).toBeEnabled();
  });

  it('settles a change needing translation when it is marked done', async () => {
    const client = makeClient({
      ...localizationSummary(),
      changes: [
        {
          classification: 'needsTranslation',
          componentId: 'HeadingBlock-1',
          propPath: '/spacing',
          upstreamOldValue: 8,
          upstreamNewValue: 12,
          documentValue: 8,
        },
      ],
      counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 1, autoApplied: 0 },
    });
    renderPanel(makeCtx(client));

    fireEvent.click(await screen.findByTestId('upstream-mark-done'));

    await waitFor(() =>
      expect(client.relations.setUpstreamResolutions).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        'doc-fr',
        [{ slotId: 'HeadingBlock-1', propPath: '/spacing' }],
        5,
      ),
    );
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('re-lists a change whose resolution could not be recorded, and says so', async () => {
    const client = makeClient(
      summaryWith({
        classification: 'autoApplied',
        componentId: 'HeadingBlock-1',
        propPath: '/spacing',
        upstreamOldValue: 8,
        upstreamNewValue: 12,
        documentValue: 8,
      }),
    );
    client.relations.setUpstreamResolutions.mockRejectedValue(new Error('Edge is full'));
    renderPanel(makeCtx(client));

    fireEvent.click(await screen.findByTestId('upstream-apply'));

    await waitFor(() => expect(addError).toHaveBeenCalled());
    expect(addError.mock.calls[0][0]).toContain('Edge is full');
    // The change is unrecorded, so it belongs back on the list.
    expect(await screen.findByTestId('upstream-apply')).toBeInTheDocument();
  });

  it('keeps a change listed when its resolution fails and the list cannot be re-read', async () => {
    const client = makeClient(
      summaryWith({
        classification: 'autoApplied',
        componentId: 'HeadingBlock-1',
        propPath: '/spacing',
        upstreamOldValue: 8,
        upstreamNewValue: 12,
        documentValue: 8,
      }),
    );
    client.relations.setUpstreamResolutions.mockRejectedValue(new Error('Edge is full'));
    renderPanel(makeCtx(client));
    await screen.findByTestId('upstream-apply');

    // Whatever failed the write usually fails the read that would correct the
    // list, so the list cannot lean on the refetch to put the change back.
    client.relations.getUpstreamDiff.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByTestId('upstream-apply'));

    await waitFor(() => expect(addError).toHaveBeenCalled());
    expect(addError.mock.calls[0][0]).toContain('It is still listed.');
    expect(await screen.findByTestId('upstream-apply')).toBeInTheDocument();
  });

  it('lists a change again when the canonical changes that prop after it was reconciled', async () => {
    const advisory = {
      classification: 'advisory',
      componentId: 'HeadingBlock-1',
      propPath: '/spacing',
      upstreamOldValue: 8,
      upstreamNewValue: 12,
      documentValue: 8,
    };
    const counts = { structural: 0, prop: 0, advisory: 1, needsTranslation: 0, autoApplied: 0 };
    const client = makeClient({ ...localizationSummary(), changes: [advisory], counts });
    client.relations.getUpstreamDiff
      .mockResolvedValueOnce({ ...localizationSummary(), changes: [advisory], counts })
      .mockResolvedValueOnce({
        ...localizationSummary(),
        changes: [],
        counts: { ...counts, advisory: 0 },
        resolvedCount: 1,
      })
      .mockResolvedValueOnce({
        ...localizationSummary(),
        changes: [{ ...advisory, upstreamOldValue: 12, upstreamNewValue: 16 }],
        counts,
      });

    const { queryClient } = renderPanel(makeCtx(client));

    const group = await screen.findByTestId('upstream-group-advisory');
    fireEvent.click(within(group).getByTestId('upstream-dismiss'));

    await waitFor(() =>
      expect(screen.queryByTestId('upstream-group-advisory')).not.toBeInTheDocument(),
    );

    await queryClient.invalidateQueries();

    expect(await screen.findByTestId('upstream-group-advisory')).toBeInTheDocument();
  });


});
