import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { RemoteDatasourceDefinition } from '../data/remote-datasources/remote-datasource-registry.js';
import {
  DatasourceRegistryProvider,
  DatasourceDataProvider,
} from '../data/fields/datasource-select-field.js';

let mockSelectedItem: { type: string; props: Record<string, unknown> } | null =
  null;
const mockDispatch = vi.fn();
const mockGetItemById = vi.fn();
const mockGetSelectorForId = vi.fn();

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => {
    return (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        selectedItem: mockSelectedItem,
        dispatch: mockDispatch,
        getItemById: mockGetItemById,
        getSelectorForId: mockGetSelectorForId,
      });
  },
  FieldLabel: ({
    children,
    label,
  }: {
    children?: React.ReactNode;
    label: string;
  }) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
}));

import { createSchemaSelectField } from '../data/fields/schema-select-field.js';

const REGISTRY: RemoteDatasourceDefinition[] = [
  {
    id: 'swapi_list',
    label: 'Star Wars Characters',
    description: 'List of characters from SWAPI',
    resolution: 'Fetched from swapi.dev',
    fields: [
      { path: 'name', description: 'Character name' },
      { path: 'height', description: 'Height in cm' },
      { path: 'homeworld', description: 'Planet name' },
    ],
  },
  {
    id: 'article_list',
    label: 'Articles',
    description: 'Published articles',
    resolution: 'Fetched from CMS',
    fields: [
      { path: 'title', description: 'Article title' },
      { path: 'author.name', description: 'Author display name' },
    ],
  },
  {
    id: 'empty_source',
    label: 'Empty Source',
    description: 'A source with no fields',
    resolution: 'N/A',
    fields: [],
  },
];

function renderField(
  registry: RemoteDatasourceDefinition[],
  value: string,
  onChange: (v: string) => void,
  readOnly = false,
) {
  const fieldDef = createSchemaSelectField({ label: 'Title field' });
  return render(
    <DatasourceRegistryProvider registry={registry}>
      {fieldDef.render({
        field: fieldDef,
        name: 'titleField',
        id: 'field-titleField',
        label: fieldDef.label,
        value,
        onChange,
        readOnly,
      })}
    </DatasourceRegistryProvider>,
  );
}

function renderFieldWithData(
  registry: RemoteDatasourceDefinition[],
  datasourceData: Record<string, unknown>,
  value: string,
  onChange: (v: string) => void,
) {
  const fieldDef = createSchemaSelectField({ label: 'Title field' });
  return render(
    <DatasourceRegistryProvider registry={registry}>
      <DatasourceDataProvider context={datasourceData}>
        {fieldDef.render({
          field: fieldDef,
          name: 'titleField',
          id: 'field-titleField',
          label: fieldDef.label,
          value,
          onChange,
        })}
      </DatasourceDataProvider>
    </DatasourceRegistryProvider>,
  );
}

describe('SchemaSelectField', () => {
  beforeEach(() => {
    mockSelectedItem = null;
    mockDispatch.mockClear();
    mockGetItemById.mockReset();
    mockGetSelectorForId.mockReset();
  });

  it('renders a FieldLabel with the configured label text', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: 'swapi_list' },
    };
    renderField(REGISTRY, '', vi.fn());

    expect(screen.getByText('Title field')).toBeInTheDocument();
  });

  it('renders a select with schema field options when datasource is selected', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: 'swapi_list' },
    };
    renderField(REGISTRY, '', vi.fn());

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    // placeholder + 3 fields
    expect(options.length).toBe(4);
    expect(options[0]).toHaveTextContent('None');
    expect(options[1]).toHaveTextContent('name');
    expect(options[2]).toHaveTextContent('height');
    expect(options[3]).toHaveTextContent('homeworld');
  });

  it('uses {{ item.<path> }} as option values', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: 'swapi_list' },
    };
    renderField(REGISTRY, '', vi.fn());

    const options = screen.getAllByRole('option');
    expect((options[1] as HTMLOptionElement).value).toBe('{{ item.name }}');
    expect((options[2] as HTMLOptionElement).value).toBe('{{ item.height }}');
    expect((options[3] as HTMLOptionElement).value).toBe('{{ item.homeworld }}');
  });

  it('calls onChange with {{ item.<path> }} value on selection', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: 'article_list' },
    };
    const onChange = vi.fn();
    renderField(REGISTRY, '', onChange);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '{{ item.title }}' } });

    expect(onChange).toHaveBeenCalledWith('{{ item.title }}');
  });

  it('reflects the current value as the selected option', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: 'swapi_list' },
    };
    renderField(REGISTRY, '{{ item.height }}', vi.fn());

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('{{ item.height }}');
  });

  it('falls back to text input when no component is selected', () => {
    mockSelectedItem = null;
    renderField(REGISTRY, '', vi.fn());

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('falls back to text input when datasource has no fields', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: 'empty_source' },
    };
    renderField(REGISTRY, '', vi.fn());

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('falls back to text input when no datasource is selected', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: '' },
    };
    renderField(REGISTRY, '', vi.fn());

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('text input calls onChange with freeform value', () => {
    mockSelectedItem = null;
    const onChange = vi.fn();
    renderField(REGISTRY, '', onChange);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '{{ item.custom }}' } });

    expect(onChange).toHaveBeenCalledWith('{{ item.custom }}');
  });

  it('disables the select when readOnly is true', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: 'swapi_list' },
    };
    renderField(REGISTRY, '', vi.fn(), true);

    const select = screen.getByRole('combobox');
    expect(select).toBeDisabled();
  });

  it('disables the text input when readOnly is true', () => {
    mockSelectedItem = null;
    renderField(REGISTRY, '', vi.fn(), true);

    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });

  it('shows field paths as option labels', () => {
    mockSelectedItem = {
      type: 'ViewBlock',
      props: { id: 'ViewBlock-1', datasourceId: 'swapi_list' },
    };
    renderField(REGISTRY, '', vi.fn());

    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveTextContent('name');
    expect(options[2]).toHaveTextContent('height');
  });

  it('supports custom datasourcePropName', () => {
    mockSelectedItem = {
      type: 'PageListBlock',
      props: { id: 'PL-1', sourceId: 'article_list' },
    };

    const fieldDef = createSchemaSelectField({ datasourcePropName: 'sourceId', label: 'Title field' });
    render(
      <DatasourceRegistryProvider registry={REGISTRY}>
        {fieldDef.render({
          field: fieldDef,
          name: 'titleField',
          id: 'field-titleField',
          label: fieldDef.label,
          value: '',
          onChange: vi.fn(),
        })}
      </DatasourceRegistryProvider>,
    );

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    // placeholder + 2 article fields
    expect(options.length).toBe(3);
    expect(options[1]).toHaveTextContent('title');
    expect(options[2]).toHaveTextContent('author.name');
  });

  it('supports custom label', () => {
    const fieldDef = createSchemaSelectField({ label: 'Image Field' });
    expect(fieldDef.label).toBe('Image Field');
  });

  it('has type "custom"', () => {
    const fieldDef = createSchemaSelectField();
    expect(fieldDef.type).toBe('custom');
  });

  it('defaults label to "Schema field"', () => {
    const fieldDef = createSchemaSelectField();
    expect(fieldDef.label).toBe('Schema field');
  });

  describe('dynamic field discovery from datasource data', () => {
    const DYNAMIC_REGISTRY: RemoteDatasourceDefinition[] = [
      {
        id: 'pokemon_list',
        label: 'Pokemon list',
        description: 'Pokemon index',
        resolution: 'Fetched from GraphQL',
        fields: [
          { path: 'items', description: 'Array of rows' },
        ],
      },
    ];

    it('extracts fields from items[0] when datasource data is available', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'pokemon_list' },
      };

      renderFieldWithData(
        DYNAMIC_REGISTRY,
        {
          pokemon_list: {
            items: [
              { index: 'bulbasaur', name: 'Bulbasaur', url: '/pokemon/bulbasaur' },
              { index: 'ivysaur', name: 'Ivysaur', url: '/pokemon/ivysaur' },
            ],
          },
        },
        '',
        vi.fn(),
      );

      const options = screen.getAllByRole('option');
      expect(options.length).toBe(4); // None + index, name, url
      expect(options[1]).toHaveTextContent('index');
      expect(options[2]).toHaveTextContent('name');
      expect(options[3]).toHaveTextContent('url');
    });

    it('uses {{ item.<path> }} as values for dynamically discovered fields', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'pokemon_list' },
      };

      renderFieldWithData(
        DYNAMIC_REGISTRY,
        {
          pokemon_list: {
            items: [
              { index: 'bulbasaur', name: 'Bulbasaur', url: '/pokemon/bulbasaur' },
            ],
          },
        },
        '',
        vi.fn(),
      );

      const options = screen.getAllByRole('option');
      expect((options[1] as HTMLOptionElement).value).toBe('{{ item.index }}');
      expect((options[2] as HTMLOptionElement).value).toBe('{{ item.name }}');
      expect((options[3] as HTMLOptionElement).value).toBe('{{ item.url }}');
    });

    it('discovers nested object fields with dot notation', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'pokemon_list' },
      };

      renderFieldWithData(
        DYNAMIC_REGISTRY,
        {
          pokemon_list: {
            items: [
              {
                name: 'Bulbasaur',
                stats: { hp: 45, attack: 49 },
              },
            ],
          },
        },
        '',
        vi.fn(),
      );

      const options = screen.getAllByRole('option');
      // None + name, stats.hp, stats.attack
      expect(options.length).toBe(4);
      expect(options[1]).toHaveTextContent('name');
      expect(options[2]).toHaveTextContent('stats.hp');
      expect(options[3]).toHaveTextContent('stats.attack');
    });

    it('falls back to static registry fields when no datasource data is available', () => {
      mockSelectedItem = {
        type: 'ViewBlock',
        props: { id: 'ViewBlock-1', datasourceId: 'swapi_list' },
      };

      renderFieldWithData(REGISTRY, {}, '', vi.fn());

      const options = screen.getAllByRole('option');
      expect(options.length).toBe(4); // None + 3 static fields
      expect(options[1]).toHaveTextContent('name');
      expect(options[2]).toHaveTextContent('height');
      expect(options[3]).toHaveTextContent('homeworld');
    });

    it('merges static registry fields with dynamic fields', () => {
      const CCR_REGISTRY: RemoteDatasourceDefinition[] = [
        {
          id: 'templates.news2',
          label: 'News2',
          description: 'CCR content query',
          resolution: 'auto-generated',
          fields: [
            { path: 'items', description: 'Array of matching documents' },
            { path: 'returnedCount', description: 'Number of items returned' },
            { path: 'items[].documentId', description: 'Document UUID' },
            { path: 'items[].path', description: 'Document path' },
            { path: 'items[].createdAt', description: 'Document creation timestamp' },
            { path: 'items[].metadata.title', description: 'Page title' },
            { path: 'items[].metadata.description', description: 'Page description' },
          ],
        },
      ];

      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'templates.news2' },
      };

      renderFieldWithData(
        CCR_REGISTRY,
        {
          'templates.news2': {
            items: [
              { documentId: 'abc-123', path: 'from-template', createdAt: '2026-06-25T00:00:00Z', metadata: {} },
            ],
            returnedCount: 1,
          },
        },
        '',
        vi.fn(),
      );

      const options = screen.getAllByRole('option');
      const labels = options.map((o) => o.textContent);
      // Dynamic fields from items[0]: documentId, path, createdAt
      // Static fields not found dynamically: metadata.title, metadata.description
      expect(labels).toContain('documentId');
      expect(labels).toContain('path');
      expect(labels).toContain('createdAt');
      expect(labels).toContain('metadata.title');
      expect(labels).toContain('metadata.description');
    });

    it('dynamic fields take precedence over static fields with same path', () => {
      const OVERLAP_REGISTRY: RemoteDatasourceDefinition[] = [
        {
          id: 'pokemon_list',
          label: 'Pokemon list',
          description: 'Pokemon index',
          resolution: 'Fetched from GraphQL',
          fields: [
            { path: 'items[].name', description: 'Static name description' },
            { path: 'items[].sprite', description: 'Sprite URL' },
          ],
        },
      ];

      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'pokemon_list' },
      };

      renderFieldWithData(
        OVERLAP_REGISTRY,
        {
          pokemon_list: {
            items: [{ name: 'Bulbasaur' }],
          },
        },
        '',
        vi.fn(),
      );

      const options = screen.getAllByRole('option');
      const labels = options.map((o) => o.textContent);
      // name from dynamic (title = "Bulbasaur"), sprite from static
      expect(labels).toContain('name');
      expect(labels).toContain('sprite');
      // name from dynamic, sprite from static — both present as options
      const nameOption = options.find((o) => o.textContent === 'name');
      expect(nameOption).toBeInTheDocument();
    });

    it('includes array values as leaf fields', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'pokemon_list' },
      };

      renderFieldWithData(
        DYNAMIC_REGISTRY,
        {
          pokemon_list: {
            items: [
              {
                name: 'Bulbasaur',
                types: ['grass', 'poison'],
              },
            ],
          },
        },
        '',
        vi.fn(),
      );

      const options = screen.getAllByRole('option');
      // None + name, types
      expect(options.length).toBe(3);
      expect(options[1]).toHaveTextContent('name');
      expect(options[2]).toHaveTextContent('types');
    });
  });

  describe('inline toggle via togglePropName', () => {
    function renderWithToggle(
      value: string,
      toggleValue: boolean,
      onChange: (v: string) => void,
    ) {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'swapi_list', showTitle: toggleValue },
      };
      const fieldDef = createSchemaSelectField({
        label: 'Title field',
        togglePropName: 'showTitle',
      });
      return render(
        <DatasourceRegistryProvider registry={REGISTRY}>
          {fieldDef.render({
            field: fieldDef,
            name: 'titleField',
            id: 'field-titleField',
            label: fieldDef.label,
            value,
            onChange,
          })}
        </DatasourceRegistryProvider>,
      );
    }

    it('renders a switch when togglePropName is set', () => {
      renderWithToggle('', true, vi.fn());

      const toggle = screen.getByRole('switch');
      expect(toggle).toBeInTheDocument();
    });

    it('switch reflects the component toggle prop value', () => {
      renderWithToggle('', true, vi.fn());
      expect(screen.getByRole('switch')).toBeChecked();
    });

    it('switch reflects false toggle value as unchecked', () => {
      renderWithToggle('', false, vi.fn());
      expect(screen.getByRole('switch')).not.toBeChecked();
    });

    it('clicking the switch dispatches replace to update the toggle prop', () => {
      const item = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'swapi_list', showTitle: true },
      };
      mockGetItemById.mockReturnValue(item);
      mockGetSelectorForId.mockReturnValue({ zone: 'default-zone', index: 0 });

      renderWithToggle('', true, vi.fn());

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      const call = mockDispatch.mock.calls[0][0];
      expect(call.type).toBe('replace');
      expect(call.destinationIndex).toBe(0);
      expect(call.destinationZone).toBe('default-zone');
      expect(call.data.props.showTitle).toBe(false);
    });

    it('does not render a switch when togglePropName is not set', () => {
      mockSelectedItem = {
        type: 'ViewBlock',
        props: { id: 'ViewBlock-1', datasourceId: 'swapi_list' },
      };
      renderField(REGISTRY, '', vi.fn());

      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });
  });

  describe('fallbackFields option', () => {
    const FALLBACK_FIELDS = [
      { path: 'title', description: 'Page title' },
      { path: 'path', description: 'Page path' },
      { path: 'updatedAt', description: 'Last updated date' },
    ];

    function renderWithFallback(
      registry: RemoteDatasourceDefinition[],
      value: string,
      onChange: (v: string) => void,
    ) {
      const fieldDef = createSchemaSelectField({
        label: 'Title field',
        fallbackFields: FALLBACK_FIELDS,
      });
      return render(
        <DatasourceRegistryProvider registry={registry}>
          {fieldDef.render({
            field: fieldDef,
            name: 'titleField',
            id: 'field-titleField',
            label: fieldDef.label,
            value,
            onChange,
          })}
        </DatasourceRegistryProvider>,
      );
    }

    it('shows fallback fields as select options when no datasource is selected', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: '' },
      };
      renderWithFallback(REGISTRY, '', vi.fn());

      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();

      const options = screen.getAllByRole('option');
      expect(options.length).toBe(4); // None + 3 fallback fields
      expect(options[1]).toHaveTextContent('title');
      expect(options[2]).toHaveTextContent('path');
      expect(options[3]).toHaveTextContent('updatedAt');
    });

    it('shows fallback field paths as option labels', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: '' },
      };
      renderWithFallback(REGISTRY, '', vi.fn());

      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveTextContent('title');
      expect(options[2]).toHaveTextContent('path');
    });

    it('uses {{ item.<path> }} as fallback option values', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: '' },
      };
      renderWithFallback(REGISTRY, '', vi.fn());

      const options = screen.getAllByRole('option');
      expect((options[1] as HTMLOptionElement).value).toBe('{{ item.title }}');
      expect((options[2] as HTMLOptionElement).value).toBe('{{ item.path }}');
    });

    it('prefers datasource fields over fallback when datasource is selected', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', datasourceId: 'swapi_list' },
      };
      renderWithFallback(REGISTRY, '', vi.fn());

      const options = screen.getAllByRole('option');
      expect(options.length).toBe(4); // None + 3 swapi fields (not fallback)
      expect(options[1]).toHaveTextContent('name');
    });

    it('shows fallback when no component is selected', () => {
      mockSelectedItem = null;
      renderWithFallback(REGISTRY, '', vi.fn());

      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();

      const options = screen.getAllByRole('option');
      expect(options.length).toBe(4); // None + 3 fallback
    });
  });
});
