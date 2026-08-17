import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

let mockSelectedItem: { type: string; props: Record<string, unknown> } | null =
  null;

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => {
    return (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ selectedItem: mockSelectedItem });
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

import {
  createImagePositionField,
  clampImagePosition,
} from '../data/fields/image-position-field.js';

function renderField(
  viewMode: string,
  value: string,
  onChange: (v: string) => void = () => {},
) {
  mockSelectedItem = {
    type: 'DataListBlock',
    props: { id: 'DL-1', viewMode },
  };
  const fieldDef = createImagePositionField();
  return render(
    fieldDef.render({
      field: fieldDef,
      name: 'imagePosition',
      id: 'field-imagePosition',
      label: fieldDef.label,
      value,
      onChange,
    }),
  );
}

describe('createImagePositionField', () => {
  beforeEach(() => {
    mockSelectedItem = null;
  });

  it('returns a custom field with correct label', () => {
    const field = createImagePositionField();
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Image position');
  });

  it('accepts a custom label', () => {
    const field = createImagePositionField({ label: 'Photo placement' });
    expect(field.label).toBe('Photo placement');
  });

  it('renders a FieldLabel with the field label', () => {
    renderField('grid','top');
    expect(screen.getByText('Image position')).toBeInTheDocument();
  });

  describe('grid mode options', () => {
    it('renders Top, Left, Right, Backdrop, None options', () => {
      renderField('grid','top');
      const select = screen.getByRole('combobox');
      const options = Array.from(select.querySelectorAll('option'));
      const values = options.map((o) => o.value);
      expect(values).toEqual(['top', 'left', 'right', 'backdrop', 'none']);
    });
  });

  describe('table mode options', () => {
    it('renders Left, None options', () => {
      renderField('table','left');
      const select = screen.getByRole('combobox');
      const options = Array.from(select.querySelectorAll('option'));
      const values = options.map((o) => o.value);
      expect(values).toEqual(['left', 'none']);
    });
  });

  describe('list mode options', () => {
    it('renders Left, Right, None options', () => {
      renderField('list','left');
      const select = screen.getByRole('combobox');
      const options = Array.from(select.querySelectorAll('option'));
      const values = options.map((o) => o.value);
      expect(values).toEqual(['left', 'right', 'none']);
    });
  });

  it('calls onChange when an option is selected', () => {
    const onChange = vi.fn();
    renderField('grid','top', onChange);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'backdrop' } });
    expect(onChange).toHaveBeenCalledWith('backdrop');
  });

  it('reflects the current value', () => {
    renderField('grid','right');
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('right');
  });

  it('disables the select when readOnly', () => {
    mockSelectedItem = {
      type: 'DataListBlock',
      props: { id: 'DL-1', viewMode: 'grid' },
    };
    const fieldDef = createImagePositionField();
    render(
      fieldDef.render({
        field: fieldDef,
        name: 'imagePosition',
        id: 'field-imagePosition',
        label: fieldDef.label,
        value: 'top',
        onChange: () => {},
        readOnly: true,
      }),
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('falls back to grid options when no component selected', () => {
    mockSelectedItem = null;
    const fieldDef = createImagePositionField();
    render(
      fieldDef.render({
        field: fieldDef,
        name: 'imagePosition',
        id: 'field-imagePosition',
        label: fieldDef.label,
        value: 'top',
        onChange: () => {},
      }),
    );
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    const values = options.map((o) => o.value);
    expect(values).toEqual(['top', 'left', 'right', 'backdrop', 'none']);
  });

  describe('visibleWhenPropName', () => {
    function renderWithVisibility(
      showImage: boolean,
      viewMode = 'cards',
      value = 'top',
    ) {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', viewMode, showImage },
      };
      const fieldDef = createImagePositionField({
        visibleWhenPropName: 'showImage',
      });
      return render(
        fieldDef.render({
          field: fieldDef,
          name: 'imagePosition',
          id: 'field-imagePosition',
          label: fieldDef.label,
          value,
          onChange: () => {},
        }),
      );
    }

    it('renders the field when the visibility prop is true', () => {
      renderWithVisibility(true);
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('hides the field when the visibility prop is false', () => {
      const { container } = renderWithVisibility(false);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(container.innerHTML).toBe('');
    });

    it('renders the field when the visibility prop is absent', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', viewMode: 'cards' },
      };
      const fieldDef = createImagePositionField({
        visibleWhenPropName: 'showImage',
      });
      render(
        fieldDef.render({
          field: fieldDef,
          name: 'imagePosition',
          id: 'field-imagePosition',
          label: fieldDef.label,
          value: 'top',
          onChange: () => {},
        }),
      );
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('hides the field label when the visibility prop is false', () => {
      renderWithVisibility(false);
      expect(screen.queryByText('Image position')).not.toBeInTheDocument();
    });

    it('renders normally without visibleWhenPropName', () => {
      mockSelectedItem = {
        type: 'DataListBlock',
        props: { id: 'DL-1', viewMode: 'grid', showImage: false },
      };
      const fieldDef = createImagePositionField();
      render(
        fieldDef.render({
          field: fieldDef,
          name: 'imagePosition',
          id: 'field-imagePosition',
          label: fieldDef.label,
          value: 'top',
          onChange: () => {},
        }),
      );
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
  });
});

describe('clampImagePosition', () => {
  it('returns a valid grid value as-is', () => {
    expect(clampImagePosition('grid', 'backdrop')).toBe('backdrop');
    expect(clampImagePosition('grid', 'top')).toBe('top');
  });

  it('returns default when grid value is invalid for list', () => {
    expect(clampImagePosition('list', 'backdrop')).toBe('left');
    expect(clampImagePosition('list', 'top')).toBe('left');
  });

  it('returns default when value is invalid for table', () => {
    expect(clampImagePosition('table', 'right')).toBe('left');
    expect(clampImagePosition('table', 'backdrop')).toBe('left');
  });

  it('keeps valid table values', () => {
    expect(clampImagePosition('table', 'left')).toBe('left');
    expect(clampImagePosition('table', 'none')).toBe('none');
  });

  it('keeps valid list values', () => {
    expect(clampImagePosition('list', 'left')).toBe('left');
    expect(clampImagePosition('list', 'right')).toBe('right');
    expect(clampImagePosition('list', 'none')).toBe('none');
  });

  it('defaults to grid when viewMode is unknown', () => {
    expect(clampImagePosition('', 'top')).toBe('top');
    expect(clampImagePosition('unknown', 'backdrop')).toBe('backdrop');
    expect(clampImagePosition('unknown', 'invalid')).toBe('top');
  });

  describe('with custom modePositions', () => {
    const custom = {
      grid: [
        { label: 'Top', value: 'top' },
        { label: 'None', value: 'none' },
      ],
      table: [{ label: 'None', value: 'none' }],
    };

    it('uses custom map when provided', () => {
      expect(clampImagePosition('grid', 'top', custom)).toBe('top');
      expect(clampImagePosition('grid', 'none', custom)).toBe('none');
    });

    it('clamps invalid value to first option of the custom mode', () => {
      expect(clampImagePosition('grid', 'backdrop', custom)).toBe('top');
      expect(clampImagePosition('table', 'left', custom)).toBe('none');
    });

    it('falls back to first mode when viewMode is unknown', () => {
      expect(clampImagePosition('unknown', 'top', custom)).toBe('top');
      expect(clampImagePosition('unknown', 'invalid', custom)).toBe('top');
    });
  });
});

describe('createImagePositionField with custom modePositions', () => {
  const customModePositions = {
    grid: [
      { label: 'Top', value: 'top' },
      { label: 'None', value: 'none' },
    ],
    table: [{ label: 'None', value: 'none' }],
  };

  function renderWithCustomModes(
    viewMode: string,
    value: string,
    onChange: (v: string) => void = () => {},
  ) {
    mockSelectedItem = {
      type: 'DataListBlock',
      props: { id: 'DL-1', viewMode },
    };
    const fieldDef = createImagePositionField({
      modePositions: customModePositions,
    });
    return render(
      fieldDef.render({
        field: fieldDef,
        name: 'imagePosition',
        id: 'field-imagePosition',
        label: fieldDef.label,
        value,
        onChange,
      }),
    );
  }

  it('renders only custom mode options for grid', () => {
    renderWithCustomModes('grid', 'top');
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    const values = options.map((o) => o.value);
    expect(values).toEqual(['top', 'none']);
  });

  it('renders only custom mode options for table', () => {
    renderWithCustomModes('table', 'none');
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    const values = options.map((o) => o.value);
    expect(values).toEqual(['none']);
  });

  it('falls back to first custom mode for unknown viewMode', () => {
    renderWithCustomModes('unknown', 'top');
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    const values = options.map((o) => o.value);
    expect(values).toEqual(['top', 'none']);
  });
});
