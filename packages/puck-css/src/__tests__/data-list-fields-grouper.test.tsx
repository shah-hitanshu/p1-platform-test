import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

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
  createUsePuck: () => () => null,
}));

import { DataListFieldsGrouper } from '../data/data-list-block/DataListFieldsGrouper.js';

function makeFieldChild(name: string) {
  return <div key={name} data-testid={`field-${name}`}>{name}</div>;
}

describe('DataListFieldsGrouper', () => {
  it('groups content fields into a CONTENT section', () => {
    render(
      <DataListFieldsGrouper>
        {makeFieldChild('heading')}
        {makeFieldChild('datasourceId')}
      </DataListFieldsGrouper>,
    );

    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByTestId('field-heading')).toBeInTheDocument();
    expect(screen.getByTestId('field-datasourceId')).toBeInTheDocument();
  });

  it('groups layout fields into a LAYOUT & STYLE section', () => {
    render(
      <DataListFieldsGrouper>
        {makeFieldChild('viewMode')}
        {makeFieldChild('columns')}
        {makeFieldChild('sortBy')}
      </DataListFieldsGrouper>,
    );

    expect(screen.getByText('Layout & style')).toBeInTheDocument();
    expect(screen.getByTestId('field-viewMode')).toBeInTheDocument();
    expect(screen.getByTestId('field-columns')).toBeInTheDocument();
  });

  it('groups field mapping fields into a sub-section within CONTENT', () => {
    render(
      <DataListFieldsGrouper>
        {makeFieldChild('datasourceId')}
        {makeFieldChild('titleField')}
        {makeFieldChild('subtitleField')}
        {makeFieldChild('imageField')}
      </DataListFieldsGrouper>,
    );

    expect(screen.getByText('Data for each Card')).toBeInTheDocument();
    expect(screen.getByTestId('field-titleField')).toBeInTheDocument();
    expect(screen.getByTestId('field-subtitleField')).toBeInTheDocument();
  });

  it('shows field count badges for each section', () => {
    render(
      <DataListFieldsGrouper>
        {makeFieldChild('heading')}
        {makeFieldChild('datasourceId')}
        {makeFieldChild('titleField')}
        {makeFieldChild('subtitleField')}
        {makeFieldChild('viewMode')}
        {makeFieldChild('sortBy')}
      </DataListFieldsGrouper>,
    );

    // Content: heading, datasourceId + fieldMapping(titleField, subtitleField) = 4
    expect(screen.getByText('4')).toBeInTheDocument();
    // Layout: viewMode, sortBy = 2
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders unknown fields at the end without dropping them', () => {
    render(
      <DataListFieldsGrouper>
        {makeFieldChild('heading')}
        {makeFieldChild('unknownField')}
      </DataListFieldsGrouper>,
    );

    expect(screen.getByTestId('field-unknownField')).toBeInTheDocument();
  });

  it('renders both sections when both content and layout fields exist', () => {
    render(
      <DataListFieldsGrouper>
        {makeFieldChild('heading')}
        {makeFieldChild('viewMode')}
      </DataListFieldsGrouper>,
    );

    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Layout & style')).toBeInTheDocument();
  });

  it('does not render empty sections', () => {
    render(
      <DataListFieldsGrouper>
        {makeFieldChild('viewMode')}
      </DataListFieldsGrouper>,
    );

    expect(screen.queryByText('Content')).toBeNull();
    expect(screen.getByText('Layout & style')).toBeInTheDocument();
  });
});
