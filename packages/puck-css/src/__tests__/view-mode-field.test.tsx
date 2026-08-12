import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
}));

import { createViewModeField } from '../data/fields/view-mode-field.js';

const OPTIONS = [
  { label: 'Grid', value: 'grid' },
  { label: 'Table', value: 'table' },
  { label: 'List', value: 'list' },
];

function renderField(
  value: string,
  onChange: (v: string) => void = () => {},
  readOnly?: boolean,
) {
  const fieldDef = createViewModeField(OPTIONS);
  return render(
    fieldDef.render({
      field: fieldDef,
      name: 'viewMode',
      id: 'field-viewMode',
      label: fieldDef.label,
      value,
      onChange,
      readOnly,
    }),
  );
}

describe('createViewModeField', () => {
  it('returns a custom field with correct label', () => {
    const field = createViewModeField(OPTIONS);
    expect(field.type).toBe('custom');
    expect(field.label).toBe('View mode');
  });

  it('renders a SegmentedButton with the correct options', () => {
    renderField('grid');
    expect(screen.getByText('Grid')).toBeInTheDocument();
    expect(screen.getByText('Table')).toBeInTheDocument();
    expect(screen.getByText('List')).toBeInTheDocument();
  });

  it('marks the current value as selected', () => {
    renderField('table');
    const tableButton = screen.getByText('Table');
    expect(tableButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Grid')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('List')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange when a different option is clicked', () => {
    const onChange = vi.fn();
    renderField('grid', onChange);
    fireEvent.click(screen.getByText('List'));
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('disables all options when readOnly is true', () => {
    renderField('grid', () => {}, true);
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });

  it('renders a FieldLabel wrapping the segmented button', () => {
    renderField('grid');
    expect(screen.getByText('View mode')).toBeInTheDocument();
  });
});
