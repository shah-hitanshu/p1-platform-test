/**
 * Two defects in the inspector's fields override, both surfaced while adding
 * the page-metadata panel.
 *
 * 1. The P1TemplateFields branch is an early return above ReadOnlyFieldsGuard,
 *    so template fields stay editable while viewing a read-only historical
 *    version.
 * 2. The Block tab dispatches `itemSelector: { zone: 'default-zone' }`, but
 *    Puck's zone index is keyed `root:default-zone` (`rootDroppableId`), so
 *    `getItem()` resolves nothing and the tab silently does nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const dispatch = vi.fn();

let itemSelector: unknown = null;
let isViewingHistoricalVersion = false;
let documentPath = '_registry/templates/marketing';

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => (selector: (s: unknown) => unknown) =>
    selector({
      appState: {
        data: { content: [{ type: 'Block', props: { id: 'block-1' } }], root: { props: {} } },
        ui: { itemSelector, rightSideBarVisible: true },
      },
      selectedItem: itemSelector ? { type: 'Block', props: { id: 'block-1' } } : null,
      dispatch,
      config: { components: { Block: { label: 'Block' } } },
    }),
}));

vi.mock('../core/P1PuckContext', () => ({
  useP1PuckOptional: () => ({
    currentDocument: { path: documentPath },
    templates: [{ id: 'tpl-1', name: 'marketing', label: 'Marketing' }],
    updateTemplate: vi.fn(),
    isViewingHistoricalVersion,
    viewingVersion: isViewingHistoricalVersion ? { versionNumber: 3 } : null,
  }),
}));

vi.mock('../editor/components/P1TemplateFields', () => ({
  P1TemplateFields: () => <input aria-label="Template label" />,
}));

vi.mock('../editor/utils/templatePath', () => ({
  templateFromRegistryPath: (path?: string) =>
    path?.startsWith('_registry/templates/') ? { id: 'tpl-1', label: 'Marketing' } : null,
}));

const { P1InspectorFields } = await import('../editor/components/P1InspectorFields.js');

beforeEach(() => {
  dispatch.mockClear();
  itemSelector = null;
  isViewingHistoricalVersion = false;
  documentPath = '_registry/templates/marketing';
});

describe('P1InspectorFields — template fields honour the read-only guard', () => {
  it('makes template fields inert when viewing a historical version', () => {
    isViewingHistoricalVersion = true;
    const { container } = render(
      <P1InspectorFields>
        <input aria-label="Page title" />
      </P1InspectorFields>,
    );

    expect(screen.getByLabelText('Template label')).toBeInTheDocument();
    expect(container.querySelector('[inert]')).not.toBeNull();
  });

  it('leaves template fields interactive on the latest version', () => {
    const { container } = render(
      <P1InspectorFields>
        <input aria-label="Page title" />
      </P1InspectorFields>,
    );

    expect(screen.getByLabelText('Template label')).toBeInTheDocument();
    expect(container.querySelector('[inert]')).toBeNull();
  });
});

describe('P1InspectorFields — Block tab selects a block', () => {
  it('dispatches the zone id Puck actually indexes', () => {
    documentPath = '/about';
    render(
      <P1InspectorFields>
        <input aria-label="Page title" />
      </P1InspectorFields>,
    );

    fireEvent.click(screen.getByRole('tab', { name: /block/i }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'setUi',
        ui: { itemSelector: { zone: 'root:default-zone', index: 0 } },
      }),
    );
  });
});
