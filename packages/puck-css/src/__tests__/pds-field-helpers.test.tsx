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

import {
  createPdsTextField,
  createPdsNumberField,
  createPdsSwitchField,
  createPdsSegmentedField,
  createPdsSelectField,
} from '../data/fields/pds-field-helpers.js';

function renderCustomField(
  fieldDef: ReturnType<typeof createPdsTextField>,
  value: unknown,
  onChange: (v: unknown) => void = () => {},
  readOnly?: boolean,
) {
  return render(
    fieldDef.render({
      field: fieldDef,
      name: 'testField',
      id: 'field-test',
      label: fieldDef.label,
      value,
      onChange,
      readOnly,
    }),
  );
}

describe('createPdsTextField', () => {
  it('returns a custom field with correct label', () => {
    const field = createPdsTextField('Heading');
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Heading');
  });

  it('renders a text input with value', () => {
    const field = createPdsTextField('Heading');
    renderCustomField(field, 'Hello');
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument();
  });

  it('calls onChange when typing', () => {
    const onChange = vi.fn();
    const field = createPdsTextField('Heading');
    renderCustomField(field, '', onChange);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'New value' },
    });
    expect(onChange).toHaveBeenCalledWith('New value');
  });

  it('disables input when readOnly', () => {
    const field = createPdsTextField('Heading');
    renderCustomField(field, '', () => {}, true);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});

describe('createPdsNumberField', () => {
  it('returns a custom field with correct label', () => {
    const field = createPdsNumberField('Max items');
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Max items');
  });

  it('renders with numeric value', () => {
    const field = createPdsNumberField('Max items');
    renderCustomField(field, 12);
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
  });

  it('calls onChange with a number', () => {
    const onChange = vi.fn();
    const field = createPdsNumberField('Max items');
    renderCustomField(field, 0, onChange);
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '5' },
    });
    expect(onChange).toHaveBeenCalledWith(5);
  });
});

describe('createPdsSwitchField', () => {
  it('returns a custom field with correct label', () => {
    const field = createPdsSwitchField('Show heading');
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Show heading');
  });

  it('renders a switch in checked state', () => {
    const field = createPdsSwitchField('Show heading');
    renderCustomField(field, true);
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('renders a switch in unchecked state', () => {
    const field = createPdsSwitchField('Show heading');
    renderCustomField(field, false);
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('calls onChange with boolean on toggle', () => {
    const onChange = vi.fn();
    const field = createPdsSwitchField('Show heading');
    renderCustomField(field, false, onChange);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('createPdsSegmentedField', () => {
  const OPTIONS = [
    { label: 'Ascending', value: 'asc' },
    { label: 'Descending', value: 'desc' },
  ];

  it('returns a custom field with correct label', () => {
    const field = createPdsSegmentedField('Sort direction', OPTIONS);
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Sort direction');
  });

  it('renders all options', () => {
    const field = createPdsSegmentedField('Sort direction', OPTIONS);
    renderCustomField(field, 'asc');
    expect(screen.getByText('Ascending')).toBeInTheDocument();
    expect(screen.getByText('Descending')).toBeInTheDocument();
  });

  it('marks the current value as active', () => {
    const field = createPdsSegmentedField('Sort direction', OPTIONS);
    renderCustomField(field, 'asc');
    expect(screen.getByText('Ascending')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('calls onChange when a different option is clicked', () => {
    const onChange = vi.fn();
    const field = createPdsSegmentedField('Sort direction', OPTIONS);
    renderCustomField(field, 'asc', onChange);
    fireEvent.click(screen.getByText('Descending'));
    expect(onChange).toHaveBeenCalledWith('desc');
  });
});

describe('createPdsSelectField', () => {
  const OPTIONS = [
    { label: 'Published', value: 'published' },
    { label: 'Draft', value: 'draft' },
  ];

  it('returns a custom field with correct label', () => {
    const field = createPdsSelectField('Status', OPTIONS);
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Status');
  });

  it('renders all options', () => {
    const field = createPdsSelectField('Status', OPTIONS);
    renderCustomField(field, 'published');
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('calls onChange when an option is selected', () => {
    const onChange = vi.fn();
    const field = createPdsSelectField('Status', OPTIONS);
    renderCustomField(field, 'published', onChange);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'draft' },
    });
    expect(onChange).toHaveBeenCalledWith('draft');
  });
});
