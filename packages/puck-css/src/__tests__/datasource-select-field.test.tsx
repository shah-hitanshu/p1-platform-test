import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { RemoteDatasourceDefinition } from '../data/remote-datasources/remote-datasource-registry.js';

vi.mock('@puckeditor/core', () => ({
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

import {
  DatasourceRegistryProvider,
  createDatasourceSelectField,
} from '../data/fields/datasource-select-field.js';

const REGISTRY: RemoteDatasourceDefinition[] = [
  {
    id: 'swapi_list',
    label: 'Star Wars Characters',
    description: 'List of characters from SWAPI',
    resolution: 'Fetched from swapi.dev',
    fields: [{ path: 'items', description: 'Array of character objects' }],
  },
  {
    id: 'article_list',
    label: 'Articles',
    description: 'Published articles',
    resolution: 'Fetched from CMS',
    fields: [{ path: 'items', description: 'Array of article objects' }],
  },
  {
    id: 'monster',
    label: 'Single Monster',
    description: 'One monster by ID',
    resolution: 'Fetched by ID',
    fields: [{ path: 'name', description: 'Monster name' }],
  },
];

function renderField(
  registry: RemoteDatasourceDefinition[],
  value: string,
  onChange: (v: string) => void,
  readOnly = false,
) {
  const fieldDef = createDatasourceSelectField();
  return render(
    <DatasourceRegistryProvider registry={registry}>
      {fieldDef.render({
        field: fieldDef,
        name: 'datasourceId',
        id: 'field-datasourceId',
        label: fieldDef.label,
        value,
        onChange,
        readOnly,
      })}
    </DatasourceRegistryProvider>,
  );
}

describe('DatasourceSelectField', () => {
  it('renders a FieldLabel with the "Datasource" label', () => {
    renderField(REGISTRY, '', vi.fn());

    expect(screen.getByText('Datasource')).toBeInTheDocument();
  });

  it('renders a select element with datasource options from registry', () => {
    renderField(REGISTRY, '', vi.fn());

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    // placeholder + 3 datasources
    expect(options.length).toBe(4);
    expect(options[0]).toHaveTextContent('Select a datasource');
    expect(options[1]).toHaveTextContent('Star Wars Characters');
    expect(options[2]).toHaveTextContent('Articles');
    expect(options[3]).toHaveTextContent('Single Monster');
  });

  it('displays datasource labels, not IDs', () => {
    renderField(REGISTRY, '', vi.fn());

    expect(screen.getByText('Star Wars Characters')).toBeInTheDocument();
    expect(screen.getByText('Articles')).toBeInTheDocument();
    expect(screen.queryByText('swapi_list')).not.toBeInTheDocument();
  });

  it('calls onChange with the selected datasource ID', () => {
    const onChange = vi.fn();
    renderField(REGISTRY, '', onChange);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'article_list' } });

    expect(onChange).toHaveBeenCalledWith('article_list');
  });

  it('reflects the current value as the selected option', () => {
    renderField(REGISTRY, 'swapi_list', vi.fn());

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('swapi_list');
  });

  it('shows an empty-state message when registry is empty', () => {
    renderField([], '', vi.fn());

    expect(screen.getByText('No datasources available')).toBeInTheDocument();
  });

  it('disables the select when readOnly is true', () => {
    renderField(REGISTRY, 'swapi_list', vi.fn(), true);

    const select = screen.getByRole('combobox');
    expect(select).toBeDisabled();
  });
});
