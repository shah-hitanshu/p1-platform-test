import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Puck, createUsePuck, useGetPuck } from '@puckeditor/core';
import type { Config, Data } from '@puckeditor/core';
import type { PuckApi } from '@puckeditor/core';
import { QueryClient } from '@tanstack/react-query';
import type { ChangeSummary } from '@pantheon-systems/css-client';
import { P1PuckContext } from '../src/core/P1PuckContext.js';
import type { P1PuckContextValue } from '../src/core/types.js';
import { P1SdkQueryClientContext } from '../src/data/query-provider.js';
import { UpstreamChangesControl } from '../src/features/localization/ui/UpstreamChangesControl.js';

const useEditor = createUsePuck();
const config: Config = {
  root: { fields: { title: { type: 'text', label: 'Page title' } } },
  components: {
    Group: { fields: { children: { type: 'slot' } }, render: () => <div /> },
    Heading: { label: 'Heading', fields: { title: { type: 'text' } }, render: () => <div /> },
  },
};

function EditorControls({ target, capture }: { target: string; capture: (getEditor: () => PuckApi) => void }) {
  const historyIndex = useEditor((s) => s.history.index);
  const value = useEditor((s) => target === '__root__'
    ? s.appState.data.root.props?.title
    : s.getSelectorForId(target) ? s.getItemById(target)?.props.title : undefined);
  const getEditor = useGetPuck();
  capture(getEditor);
  return <>
    <input aria-label="Translation" value={String(value ?? '')} onChange={(event) => {
      const editor = getEditor();
      const title = event.target.value;
      if (target === '__root__') {
        editor.dispatch({ type: 'setData', recordHistory: true, data: (previous) => ({
          ...previous, root: { ...previous.root, props: { ...previous.root.props, title } },
        }) });
      } else {
        const selector = editor.getSelectorForId(target)!;
        const item = editor.getItemById(target)!;
        editor.dispatch({ type: 'replace', destinationIndex: selector.index,
          destinationZone: selector.zone, data: { ...item, props: { ...item.props, title } } });
      }
    }} />
    <output data-testid="history-index">{historyIndex}</output>
    <button onClick={() => getEditor().history.back()}>Undo edit</button>
    <button onClick={() => getEditor().history.forward()}>Redo edit</button>
    <button onClick={() => getEditor().dispatch({ type: 'remove', index: 0,
      zone: 'root:default-zone' })}>Remove blocks</button>
  </>;
}

interface ReviewOptions {
  data?: Data<Record<string, Record<string, unknown>>, Record<string, unknown>>;
  summary?: Partial<ChangeSummary>;
  template?: boolean;
}

function setup(target = '__root__', options: ReviewOptions = {}) {
  let readEditor: () => PuckApi = () => { throw new Error('Editor not mounted'); };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const summary: ChangeSummary = {
    relationType: 'localization',
    derivedDocumentId: 'translation',
    upstreamDocumentId: 'source',
    fromVersion: 3,
    toVersion: 5,
    fromVersionId: 'v3',
    toVersionId: 'v5',
    slotDelta: {},
    changes: [{
      classification: 'needsTranslation',
      componentId: target,
      propPath: '/title',
      upstreamOldValue: 'Hello',
      upstreamNewValue: 'Hello there',
      documentValue: 'Saved translation',
    }],
    counts: { structural: 0, prop: 0, advisory: 0, needsTranslation: 1, autoApplied: 0 },
    ...options.summary,
  };

  const client = {
    relations: {
      getUpstreamDiff: vi.fn(async () => structuredClone(summary)),
      setUpstreamResolutions: vi.fn(async (
        _site: string,
        _branch: string,
        _document: string,
        targets: { slotId: string; propPath: string }[],
      ) => {
        summary.changes = summary.changes.filter((entry) => !targets.some(
          (resolution) => resolution.slotId === entry.componentId && resolution.propPath === entry.propPath,
        ));

        return { upstreamResolutions: {} };
      }),
    },
  };

  const context = {
    client, siteId: 'site', branchId: 'workstream',
    currentDocument: { id: 'translation', path: '/fr', locale: 'fr-FR', localizedFromId: 'source', templateId: options.template ? 'template' : undefined },
    notifications: { addError: vi.fn() },
  } as unknown as P1PuckContextValue;
  const data = options.data ?? {
    root: { props: { title: 'Bonjour' } },
    content: [{ type: 'Group', props: { id: 'group', children: [
      { type: 'Heading', props: { id: 'nested-heading', title: 'Bonjour' } },
    ] } }],
  };

  const tree = () => (
    <P1SdkQueryClientContext.Provider value={queryClient}>
      <P1PuckContext.Provider value={{ ...context }}>
        <Puck config={config} data={data} iframe={{ enabled: false }}>
          <EditorControls target={target} capture={(getEditor) => { readEditor = getEditor; }} />
          <UpstreamChangesControl relationType={options.template ? 'template' : 'localization'} />
        </Puck>
      </P1PuckContext.Provider>
    </P1SdkQueryClientContext.Provider>
  );

  const rendered = render(tree());

  return {
    summary,
    client,
    context,
    queryClient,
    getEditor: () => readEditor(),
    rerender: () => rendered.rerender(tree()),
  };
}

async function open() {
  fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
  await screen.findByTestId('upstream-current-value');
}

async function close() {
  fireEvent.click(screen.getByTestId('upstream-changes-drawer-close'));
  await waitFor(() => expect(screen.queryByTestId('upstream-changes-drawer')).not.toBeInTheDocument());
}

describe('Source review in the editor', () => {
  it('shows the live translation before and after replacement, refresh, and rollback', async () => {
    const { summary, queryClient } = setup();
    await open();
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Bonjour');
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Hello there');
    summary.changes[0]!.documentValue = 'Hello there';
    await act(() => queryClient.invalidateQueries());
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Bonjour');
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Bonjour');
  });

  it('follows edits without replacement and protects edits made after replacement', async () => {
    setup();
    await open();
    fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'Salut' } });
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Salut');
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'Salut à tous' } });
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Salut à tous');
    expect(screen.getByTestId('upstream-rollback')).toBeDisabled();
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Salut à tous');
  });

  it('retains replacement recovery when the drawer is reopened', async () => {
    setup();
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    await close();
    await open();
    expect(screen.getByTestId('upstream-apply-draft')).toBeDisabled();
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Bonjour');
  });

  it('follows editor undo and redo through replacement and rollback', async () => {
    setup();
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    await waitFor(() => expect(screen.getByTestId('history-index')).toHaveTextContent('1'));
    fireEvent.click(screen.getByText('Undo edit'));
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Bonjour');
    expect(screen.getByTestId('upstream-apply-draft')).toBeEnabled();
    fireEvent.click(screen.getByText('Redo edit'));
    expect(screen.getByTestId('upstream-rollback')).toBeEnabled();
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    await waitFor(() => expect(screen.getByTestId('history-index')).toHaveTextContent('2'));
    fireEvent.click(screen.getByText('Undo edit'));
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Hello there');
    expect(screen.getByTestId('upstream-rollback')).toBeEnabled();
    fireEvent.click(screen.getByText('Redo edit'));
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Bonjour');
  });

  it('reads and restores a field in a nested slot', async () => {
    setup('nested-heading');
    await open();
    expect(screen.getByText('Heading · Title')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Hello there');
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Bonjour');
  });

  it('retains same-tick sibling edits when replacing and rolling back a component field', async () => {
    const { getEditor } = setup('nested-heading');
    await open();

    const setSpacing = (spacing: number) => {
      const editor = getEditor();
      const selector = editor.getSelectorForId('nested-heading')!;
      const item = editor.getItemById('nested-heading')!;
      editor.dispatch({
        type: 'replace',
        destinationIndex: selector.index,
        destinationZone: selector.zone,
        data: { ...item, props: { ...item.props, spacing } },
      });
    };

    const apply = screen.getByTestId('upstream-apply-draft');
    act(() => {
      setSpacing(12);
      apply.click();
      expect(getEditor().getItemById('nested-heading')?.props).toMatchObject({
        title: 'Hello there', spacing: 12,
      });
    });

    const rollback = screen.getByTestId('upstream-rollback');
    act(() => {
      setSpacing(24);
      rollback.click();
      expect(getEditor().getItemById('nested-heading')?.props).toMatchObject({
        title: 'Bonjour', spacing: 24,
      });
    });
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Bonjour');
  });

  it('disables writes when the target block is removed', async () => {
    setup('nested-heading');
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    fireEvent.click(screen.getByText('Remove blocks'));
    expect(screen.getByTestId('upstream-rollback')).toBeDisabled();
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Block unavailable');
  });

  it('retains the original recovery value when the source changes again', async () => {
    const { summary, queryClient } = setup();
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    summary.toVersion = 6;
    summary.toVersionId = 'v6';
    summary.changes[0]!.upstreamNewValue = 'Welcome';
    await act(() => queryClient.invalidateQueries());
    await waitFor(() => expect(screen.getByTestId('upstream-new-value')).toHaveTextContent('Welcome'));
    expect(screen.getByTestId('upstream-apply-draft')).toBeEnabled();
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Bonjour');
  });

  it('starts a new review session when the workstream changes', async () => {
    const { context, rerender } = setup();
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    context.branchId = 'another-workstream';
    rerender();
    await waitFor(() => expect(screen.queryByTestId('upstream-changes-drawer')).not.toBeInTheDocument());
    await open();
    expect(screen.queryByTestId('upstream-rollback')).not.toBeInTheDocument();
  });

  it('restores the current translation when a newer source replacement is rolled back', async () => {
    const { summary, queryClient } = setup();
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'Salut à tous' } });
    summary.toVersion = 6;
    summary.toVersionId = 'v6';
    summary.changes[0]!.upstreamNewValue = 'Welcome';
    await act(() => queryClient.invalidateQueries());
    await waitFor(() => expect(screen.getByTestId('upstream-apply-draft')).toBeEnabled());
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Welcome');
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Salut à tous');
  });

  it('keeps an unchanged source value from replacing a later translation again', async () => {
    const { summary, queryClient } = setup();
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'Salut à tous' } });
    summary.toVersion = 6;
    summary.toVersionId = 'v6';
    await act(() => queryClient.invalidateQueries());
    await waitFor(() => expect(screen.getAllByText('Source · v6')).toHaveLength(2));
    expect(screen.getByTestId('upstream-apply-draft')).toBeDisabled();
    expect(screen.getByLabelText('Translation')).toHaveValue('Salut à tous');
  });

  it('marks a translation done without replacing its content', async () => {
    const { client } = setup();
    await open();
    fireEvent.click(screen.getByTestId('upstream-mark-done'));
    await screen.findByTestId('upstream-all-clear');
    expect(screen.getByLabelText('Translation')).toHaveValue('Bonjour');
    expect(client.relations.setUpstreamResolutions).toHaveBeenCalledWith('site', 'workstream', 'translation', [{ slotId: '__root__', propPath: '/title' }], 'v5');
  });

  it('applies an inherited value and records its resolution', async () => {
    const { client } = setup('__root__', { summary: { changes: [{ classification: 'autoApplied', componentId: '__root__', propPath: '/title', upstreamNewValue: 'Hello' }] } });
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Hello');
    await screen.findByTestId('upstream-all-clear');
    expect(client.relations.setUpstreamResolutions).toHaveBeenCalledTimes(1);
  });

  it('keeps advisory wording and records its dismissal', async () => {
    setup('__root__', { summary: { changes: [{ classification: 'advisory', componentId: '__root__', propPath: '/title', upstreamNewValue: 'Hello' }] } });
    await open();
    expect(screen.queryByTestId('upstream-apply')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('upstream-dismiss'));
    await screen.findByTestId('upstream-all-clear');
    expect(screen.getByLabelText('Translation')).toHaveValue('Bonjour');
  });

  it('shows structural changes without offering an action', async () => {
    const { client } = setup('__root__', { summary: { changes: [
      { classification: 'structural', componentId: 'group', structuralKind: 'moved' },
    ] } });
    fireEvent.click(await screen.findByTestId('upstream-structural-changes-pill'));
    await screen.findByTestId('upstream-structural-note');

    const disclosure = screen.getByTestId('upstream-structural-disclosure');
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.getByTestId('upstream-structural-note')).toBeInTheDocument();
    expect(screen.queryByTestId('upstream-structural-mark-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('upstream-structural-changes-pill')).toHaveTextContent(
      'Structure changed',
    );
    expect(client.relations.setUpstreamResolutions).not.toHaveBeenCalled();
  });

  it('applies template changes without writing a localization resolution', async () => {
    const { client } = setup('__root__', { template: true, summary: { relationType: 'template', changes: [
      { classification: 'prop', componentId: '__root__', propPath: '/title', upstreamNewValue: 'Hello' },
    ] } });
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply'));
    expect(screen.getByLabelText('Translation')).toHaveValue('Hello');
    await screen.findByTestId('upstream-all-clear');
    expect(client.relations.setUpstreamResolutions).not.toHaveBeenCalled();
  });

  it('keeps the live edit available when recording its resolution fails', async () => {
    const { client } = setup('__root__', { summary: { changes: [
      { classification: 'autoApplied', componentId: '__root__', propPath: '/title', upstreamNewValue: 'Hello' },
    ] } });
    await open();
    client.relations.setUpstreamResolutions.mockRejectedValue(new Error('offline'));
    client.relations.getUpstreamDiff.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByTestId('upstream-apply'));
    await screen.findByTestId('upstream-refresh-failed');
    expect(screen.getByTestId('upstream-apply')).toBeEnabled();
    expect(screen.getByTestId('upstream-current-value')).toHaveTextContent('Hello');
  });

  it('restores an absent field without leaving an undefined property', async () => {
    const { getEditor } = setup('__root__', { data: { root: { props: { description: 'Description' } }, content: [] } });
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(getEditor().appState.data.root.props).toEqual({ description: 'Description' });
  });

  it('restores an object-valued field after equivalent key reordering', async () => {
    const original = { label: 'Bonjour', color: 'bleu' };
    const { getEditor } = setup('__root__', {
      data: { root: { props: { badge: original } }, content: [] },
      summary: { changes: [{ classification: 'needsTranslation', componentId: '__root__', propPath: '/badge', upstreamNewValue: { label: 'Hello', color: 'blue' } }] },
    });
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    act(() => getEditor().dispatch({ type: 'setData', data: (previous) => ({ ...previous,
      root: { props: { ...previous.root.props, badge: { color: 'blue', label: 'Hello' } } },
    }) }));
    expect(screen.getByTestId('upstream-rollback')).toBeEnabled();
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(getEditor().appState.data.root.props?.badge).toEqual(original);
  });

  it('replaces and restores one nested array value without changing its siblings', async () => {
    const { getEditor } = setup('__root__', {
      data: { root: { props: { items: [{ title: 'Un' }, { title: 'Deux' }] } }, content: [] },
      summary: { changes: [{ classification: 'needsTranslation', componentId: '__root__', propPath: '/items/1/title', upstreamNewValue: 'Two' }] },
    });
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    expect(getEditor().appState.data.root.props?.items).toEqual([{ title: 'Un' }, { title: 'Two' }]);
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(getEditor().appState.data.root.props?.items).toEqual([{ title: 'Un' }, { title: 'Deux' }]);
  });

  it('restores an array element removed by the source without losing its following sibling', async () => {
    const { getEditor } = setup('__root__', {
      data: { root: { props: { items: ['Un', 'Deux', 'Trois'] } }, content: [] },
      summary: { changes: [{ classification: 'needsTranslation', componentId: '__root__', propPath: '/items/1' }] },
    });
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    expect(getEditor().appState.data.root.props?.items).toEqual(['Un', 'Trois']);
    expect(screen.getByTestId('upstream-rollback')).toBeEnabled();
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(getEditor().appState.data.root.props?.items).toEqual(['Un', 'Deux', 'Trois']);
  });

  it('restores an absent parent object when undoing a nested replacement', async () => {
    const { getEditor } = setup('__root__', {
      data: { root: { props: { title: 'Bonjour' } }, content: [] },
      summary: { changes: [{ classification: 'needsTranslation', componentId: '__root__', propPath: '/badge/label', upstreamNewValue: 'Hello' }] },
    });
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    expect(getEditor().appState.data.root.props?.badge).toEqual({ label: 'Hello' });
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(getEditor().appState.data.root.props).toEqual({ title: 'Bonjour' });
  });

  it('reads and restores fields in legacy zones', async () => {
    const { getEditor } = setup('legacy-heading', { data: {
      root: { props: {} }, content: [{ type: 'Group', props: { id: 'group' } }],
      zones: { 'group:legacy': [{ type: 'Heading', props: { id: 'legacy-heading', title: 'Bonjour' } }] },
    } });
    await open();
    fireEvent.click(screen.getByTestId('upstream-apply-draft'));
    expect(getEditor().getItemById('legacy-heading')?.props.title).toBe('Hello there');
    fireEvent.click(screen.getByTestId('upstream-rollback'));
    expect(getEditor().getItemById('legacy-heading')?.props.title).toBe('Bonjour');
  });

  it('leaves another field display untouched when an unrelated field is edited', async () => {
    const { getEditor } = setup('__root__', { summary: { changes: [
      { classification: 'needsTranslation', componentId: '__root__', propPath: '/title', upstreamNewValue: 'Hello' },
      { classification: 'needsTranslation', componentId: 'nested-heading', propPath: '/title', upstreamNewValue: 'Welcome' },
    ] } });
    fireEvent.click(await screen.findByTestId('upstream-changes-pill'));
    await screen.findAllByTestId('upstream-current-value');
    const unchanged = screen.getAllByTestId('upstream-current-value')[1]!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(unchanged, { subtree: true, childList: true, characterData: true, attributes: true });
    fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'Salut' } });
    await act(async () => {});
    observer.disconnect();
    expect(screen.getAllByTestId('upstream-current-value')[0]).toHaveTextContent('Salut');
    expect(unchanged).toHaveTextContent('Bonjour');
    expect(mutations).toHaveLength(0);
    expect(getEditor().getItemById('nested-heading')?.props.title).toBe('Bonjour');
  });
});
