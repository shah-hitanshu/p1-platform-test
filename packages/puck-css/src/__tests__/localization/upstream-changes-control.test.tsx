/**
 * Upstream changes in the editor toolbar
 *
 * The control appears only while the open page has changes to reconcile, and
 * carries how many changes are outstanding. Opening it raises the drawer
 * that names the two versions being compared and lists the changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { NotFoundError } from '@pantheon-systems/css-client';
import type { P1PuckContextValue } from '../../core/types.js';
import { resolveFeatureConfig } from '../../core/featureConfig.js';
import { P1PuckContext } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';

vi.mock('@puckeditor/core', () => ({
  usePuck: () => ({ dispatch: vi.fn(), refreshPermissions: vi.fn() }),
  createUsePuck: () => (selector: (s: unknown) => unknown) =>
    selector({ dispatch: vi.fn(), selectedItem: null, config: {},
      appState: { data: { root: { props: { title: 'ホーム' } } } },
      getSelectorForId: () => ({ zone: 'root:default-zone', index: 0 }),
      getItemById: () => ({ type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'やめられない、あの食感。' } }),
    }),
  useGetPuck: () => () => ({ appState: { data: { content: [], root: { props: {} } } } }),
}));

import { UpstreamChangesControl } from '../../features/localization/ui/UpstreamChangesControl.js';

const translationDoc = {
  id: 'doc-ja',
  siteId: 'site-1',
  path: 'pages/home.ja-JP',
  locale: 'ja-JP',
  localizedFromId: 'doc-canonical',
};

const getUpstreamDiff = vi.fn();

/**
 * A client whose diff reflects what has been recorded through it, which is the
 * backend's contract. A mock that keeps reporting a settled change makes the
 * refetch after a write look like a regression.
 */
function recordingRelations(base: ReturnType<typeof summary>) {
  const recorded = new Set<string>();
  return {
    getUpstreamDiff: vi.fn(() =>
      Promise.resolve({
        ...base,
        changes: base.changes.filter(
          (change) => !recorded.has(`${change.componentId}:${change.propPath ?? ''}`),
        ),
      }),
    ),
    setUpstreamResolutions: vi.fn(
      (
        _siteId: string,
        _branchId: string,
        _documentId: string,
        targets: { slotId: string; propPath: string }[],
      ) => {
        for (const each of targets) recorded.add(`${each.slotId}:${each.propPath}`);
        return Promise.resolve({ upstreamResolutions: {} });
      },
    ),
  };
}

const oneAdvisoryChange = () =>
  summary({
    changes: [
      {
        classification: 'advisory',
        componentId: '__root__',
        propPath: '/title',
        upstreamOldValue: 'Home',
        upstreamNewValue: 'Homepage',
        documentValue: 'ホーム',
      },
    ],
    counts: { structural: 0, prop: 0, advisory: 1, needsTranslation: 0, autoApplied: 0 },
  });

function summary(overrides: Record<string, unknown> = {}) {
  return {
    relationType: 'localization',
    derivedDocumentId: 'doc-ja',
    upstreamDocumentId: 'doc-canonical',
    fromVersion: 10,
    toVersion: 12,
    slotDelta: {},
    changes: [
      {
        classification: 'needsTranslation',
        componentId: 'HeadingBlock-1',
        propPath: '/title',
        upstreamOldValue: 'Old',
        upstreamNewValue: "The snap you can't put down.",
        documentValue: 'やめられない、あの食感。',
        translatable: true,
      },
    ],
    counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 1, autoApplied: 0 },
    resolvedCount: 0,
    ...overrides,
  };
}

function renderControl(
  currentDocument: unknown = translationDoc,
  relations: Record<string, unknown> = {},
  relationType: 'localization' | 'template' = 'localization',
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx = {
    client: { relations: { getUpstreamDiff, setUpstreamResolutions: vi.fn(), ...relations } },
    notifications: { addError: vi.fn() },
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument,
    documents: [translationDoc],
    featureConfig: resolveFeatureConfig({}),
  } as unknown as P1PuckContextValue;

  return {
    ...render(
      <P1SdkQueryClientContext.Provider value={queryClient}>
        <P1PuckContext.Provider value={ctx}>
          <UpstreamChangesControl relationType={relationType} />
        </P1PuckContext.Provider>
      </P1SdkQueryClientContext.Provider>,
    ),
    queryClient,
  };
}

/**
 * Blocks until the summary fetch has settled. Asserting the control is absent
 * before then passes whether or not the gate works.
 */
async function settled(queryClient: QueryClient, status: 'success' | 'error'): Promise<void> {
  await waitFor(() => {
    const states = queryClient.getQueryCache().findAll({ queryKey: ['p1-upstream-diff'] });
    expect(states.some((query) => query.state.status === status)).toBe(true);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUpstreamDiff.mockResolvedValue(summary());
});

afterEach(() => cleanup());

describe('UpstreamChangesControl', () => {
  it('counts the changes the page has yet to take', async () => {
    renderControl();

    // One change listed, against a v10-to-v12 span: the version numbers belong
    // to different branches and do not count the changes between them.
    expect(await screen.findByTestId('upstream-changes-pill')).toHaveTextContent(
      '1 source change since v10',
    );
  });

  it('previews structural-only changes and expands the remainder', async () => {
    getUpstreamDiff.mockResolvedValue(summary({
      changes: [
        { classification: 'structural', componentId: 'Section-1', structuralKind: 'moved' },
        { classification: 'structural', componentId: 'Section-2', structuralKind: 'added' },
        { classification: 'structural', componentId: 'Section-3', structuralKind: 'removed' },
        { classification: 'structural', componentId: 'Section-4', structuralKind: 'moved' },
      ],
      counts: { structural: 4, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 0 },
    }));
    renderControl();

    const pill = await screen.findByTestId('upstream-structural-changes-pill');
    expect(pill).toHaveTextContent('Structure changed');
    expect(pill).toHaveAttribute('aria-label', 'View structural changes from the source');

    fireEvent.click(pill);
    const disclosure = await screen.findByTestId('upstream-structural-disclosure');
    expect(disclosure).toHaveTextContent('Page structure');
    expect(screen.getAllByTestId('upstream-structural-note')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more structural change' }));
    expect(screen.getAllByTestId('upstream-structural-note')).toHaveLength(4);
    const collapse = screen.getByRole('button', { name: 'Show fewer structural changes' });
    expect(collapse).toBeInTheDocument();
    expect(collapse.closest('[data-testid="upstream-structural-list"]')).toBeNull();
    expect(screen.getByTestId('upstream-structural-list').className).toContain(
      'structuralListExpanded',
    );
  });

  it('does not include structural changes in the actionable count', async () => {
    getUpstreamDiff.mockResolvedValue(summary({
      changes: [
        ...summary().changes,
        { classification: 'structural', componentId: 'Section-1', structuralKind: 'moved' },
      ],
      counts: { structural: 1, prop: 0, advisory: 0, needsTranslation: 1, autoApplied: 0 },
    }));
    renderControl();

    expect(await screen.findByTestId('upstream-changes-pill')).toHaveTextContent(
      '1 source change since v10',
    );
    expect(screen.queryByTestId('upstream-structural-changes-pill')).not.toBeInTheDocument();
  });

  it('counts the outstanding changes for a reader who cannot see the pill', async () => {
    renderControl();

    expect(await screen.findByTestId('upstream-changes-pill')).toHaveAttribute(
      'aria-label',
      'Review 1 upstream change',
    );
  });

  it('stays out of the toolbar while nothing is outstanding', async () => {
    getUpstreamDiff.mockResolvedValue(summary({ changes: [], counts: {} }));
    const { container, queryClient } = renderControl();

    await settled(queryClient, 'success');
    expect(container).toBeEmptyDOMElement();
  });

  it('stays out of the toolbar on a page that derives from nothing, without asking', async () => {
    const { container } = renderControl({ ...translationDoc, localizedFromId: null });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(getUpstreamDiff).not.toHaveBeenCalled();
  });

  it('stays out of the toolbar when the page has no upstream edge', async () => {
    getUpstreamDiff.mockRejectedValue(new NotFoundError('no edge'));
    const { container, queryClient } = renderControl();

    await settled(queryClient, 'error');
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves the toolbar once the upstream edge is gone', async () => {
    const { container, queryClient } = renderControl();
    await screen.findByTestId('upstream-changes-pill');

    // React Query serves the last good summary through a failed refetch, so the
    // pill would otherwise keep offering changes against an edge that has gone.
    getUpstreamDiff.mockRejectedValue(new NotFoundError('no edge'));
    await queryClient.invalidateQueries({ queryKey: ['p1-upstream-diff'] });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('reports a check it could not make rather than standing down', async () => {
    getUpstreamDiff.mockRejectedValue(new Error('upstream diff unavailable'));
    const { queryClient } = renderControl();

    await settled(queryClient, 'error');

    // An absent control is how the toolbar says "in sync". A check that failed
    // knows of no changes either, and must not borrow that reading.
    const pill = screen.getByTestId('upstream-changes-unavailable');
    expect(pill).toHaveTextContent('Check failed');
    expect(pill).toHaveAttribute(
      'aria-label',
      'Upstream changes could not be checked: upstream diff unavailable. Check again.',
    );
    expect(screen.queryByTestId('upstream-changes-pill')).not.toBeInTheDocument();
  });

  it('takes the check again from the failed control', async () => {
    getUpstreamDiff.mockRejectedValue(new Error('upstream diff unavailable'));
    const { queryClient } = renderControl();
    await settled(queryClient, 'error');

    getUpstreamDiff.mockResolvedValue(summary());
    fireEvent.click(screen.getByTestId('upstream-changes-unavailable'));

    expect(await screen.findByTestId('upstream-changes-pill')).toHaveTextContent(
      '1 source change since v10',
    );
  });

  it('keeps the last list read when a refresh fails, and says the refresh failed', async () => {
    const { queryClient } = renderControl();
    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    await screen.findByTestId('upstream-group-needsTranslation');

    getUpstreamDiff.mockRejectedValue(new Error('upstream diff unavailable'));
    await queryClient.invalidateQueries({ queryKey: ['p1-upstream-diff'] });

    // The changes already read are still worth acting on, so the failure is
    // reported beside the list rather than in place of it.
    expect(await screen.findByTestId('upstream-refresh-failed')).toHaveTextContent(
      'upstream diff unavailable. Showing the last list read.',
    );
    expect(screen.getByTestId('upstream-group-needsTranslation')).toBeInTheDocument();
    expect(screen.getByTestId('upstream-changes-pill')).toHaveTextContent('1 source change since v10');
  });

  it('opens a drawer naming the versions being compared', async () => {
    renderControl();

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));

    const drawer = await screen.findByTestId('upstream-changes-drawer');
    expect(drawer).toHaveTextContent('Source · v12');
    expect(drawer).toHaveTextContent('synced from v10');
    expect(drawer).toHaveTextContent('pages/home.ja-JP');
  });

  it("names the drawer's locale in its own language", async () => {
    renderControl();

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));

    expect(await screen.findByTestId('upstream-changes-drawer')).toHaveTextContent('日本語');
  });

  it('lists the outstanding changes in the drawer', async () => {
    renderControl();

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));

    expect(await screen.findByTestId('upstream-group-needsTranslation')).toBeInTheDocument();
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent(
      'やめられない、あの食感。',
    );
  });

  it('closes on the close control', async () => {
    renderControl();

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    fireEvent.click(await screen.findByTestId('upstream-changes-drawer-close'));

    await waitFor(() =>
      expect(screen.queryByTestId('upstream-changes-drawer')).not.toBeInTheDocument(),
    );
  });

  it('closes on Escape', async () => {
    renderControl();

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    await screen.findByTestId('upstream-changes-drawer');
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByTestId('upstream-changes-drawer')).not.toBeInTheDocument(),
    );
  });

  it('keeps an open drawer when the last change is settled', async () => {
    renderControl(translationDoc, recordingRelations(oneAdvisoryChange()));

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    fireEvent.click(await screen.findByTestId('upstream-dismiss'));

    // Settling the last change empties the pill. Tearing the drawer down with it
    // would lose the reader's place and strand a failed write.
    await waitFor(() =>
      expect(screen.queryByTestId('upstream-changes-pill')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('upstream-changes-drawer')).toBeInTheDocument();
    expect(await screen.findByTestId('upstream-all-clear')).toBeInTheDocument();
  });

  it('sees the drawer out before leaving with nothing outstanding', async () => {
    renderControl(translationDoc, recordingRelations(oneAdvisoryChange()));

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    fireEvent.click(await screen.findByTestId('upstream-dismiss'));
    await screen.findByTestId('upstream-all-clear');
    fireEvent.click(screen.getByTestId('upstream-changes-drawer-close'));

    // With nothing outstanding there is no pill holding the control on screen,
    // and the drawer closes by animation: leaving on the closing click would
    // take the drawer down before it could slide out.
    expect(screen.getByTestId('upstream-changes-drawer')).toBeInTheDocument();
  });

  it('leaves the toolbar once the drawer is closed with nothing outstanding', async () => {
    const { container } = renderControl(translationDoc, recordingRelations(oneAdvisoryChange()));

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    fireEvent.click(await screen.findByTestId('upstream-dismiss'));
    await screen.findByTestId('upstream-all-clear');
    fireEvent.click(screen.getByTestId('upstream-changes-drawer-close'));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('counts a dismissal against the pill, and keeps it once the drawer closes', async () => {
    // A template edge has nowhere to record a resolution, so the dismissal is
    // held in the editor; the pill and the list have to agree about it.
    getUpstreamDiff.mockResolvedValue(
      summary({
        relationType: 'template',
        changes: [
          {
            classification: 'prop',
            componentId: 'HeadingBlock-1',
            propPath: '/title',
            upstreamOldValue: 'Old',
            upstreamNewValue: 'New',
            documentValue: 'Old',
          },
          {
            classification: 'advisory',
            componentId: '__root__',
            propPath: '/subtitle',
            upstreamOldValue: 'A',
            upstreamNewValue: 'B',
            documentValue: 'A',
          },
        ],
        counts: { structural: 0, prop: 1, advisory: 1, needsTranslation: 0, autoApplied: 0 },
      }),
    );
    renderControl({ ...translationDoc, templateId: 'tpl-1' }, {}, 'template');

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    fireEvent.click(await screen.findByTestId('upstream-dismiss'));

    await waitFor(() =>
      expect(screen.getByTestId('upstream-changes-pill')).toHaveAttribute(
        'aria-label',
        'Review 1 upstream change',
      ),
    );

    fireEvent.click(screen.getByTestId('upstream-changes-drawer-close'));
    await waitFor(() =>
      expect(screen.queryByTestId('upstream-changes-drawer')).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('upstream-changes-pill'));

    // Reopening must not bring the dismissed change back.
    await screen.findByTestId('upstream-changes-drawer');
    expect(screen.queryByTestId('upstream-dismiss')).not.toBeInTheDocument();
  });

  it('reads the summary once for the pill and the drawer together', async () => {
    renderControl();

    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    await screen.findByTestId('upstream-group-needsTranslation');

    // The pill has to know the count to decide whether to appear, so the drawer
    // reuses that read rather than making its own.
    expect(getUpstreamDiff).toHaveBeenCalledTimes(1);
  });
});
