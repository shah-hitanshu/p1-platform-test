import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { P1PuckContext } from '../core/P1PuckContext.js';
import type { P1PuckContextValue } from '../core/types.js';
import { createTemplateSelectField } from '../data/fields/template-select-field.js';
import type { TemplateSummary } from '../features/content-type-templates/types.js';

const TEMPLATES: TemplateSummary[] = [
  {
    id: 'tmpl-1',
    name: 'blog-post',
    label: 'Blog Post',
    description: 'A standard blog post layout',
    version: 1,
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'tmpl-2',
    name: 'product-card',
    label: 'Product Card',
    version: 2,
    updatedAt: '2025-02-01T00:00:00Z',
  },
  {
    id: 'tmpl-3',
    name: 'deprecated-layout',
    label: 'Old Layout',
    deprecated: true,
    version: 1,
    updatedAt: '2024-06-01T00:00:00Z',
  },
];

function createMockContext(
  templatesList: TemplateSummary[] = TEMPLATES,
): P1PuckContextValue {
  return {
    client: {
      templates: {
        list: vi.fn().mockResolvedValue(templatesList),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
    siteId: 'site-1',
    branchId: 'branch-1',
  } as unknown as P1PuckContextValue;
}

function renderField(
  context: P1PuckContextValue,
  value: string,
  onChange: (v: string) => void,
  readOnly = false,
) {
  const fieldDef = createTemplateSelectField();
  return render(
    <P1PuckContext.Provider value={context}>
      {fieldDef.render({
        field: fieldDef,
        name: 'templateId',
        id: 'field-templateId',
        value,
        onChange,
        readOnly,
      })}
    </P1PuckContext.Provider>,
  );
}

describe('TemplateSelectorField', () => {
  let mockContext: P1PuckContextValue;

  beforeEach(() => {
    mockContext = createMockContext();
  });

  it('shows loading state while templates are being fetched', () => {
    renderField(mockContext, '', vi.fn());

    expect(screen.getByText('Loading templates…')).toBeInTheDocument();
  });

  it('renders a select with template options after loading', async () => {
    renderField(mockContext, '', vi.fn());

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const options = screen.getAllByRole('option');
    // placeholder + 2 non-deprecated templates
    expect(options.length).toBe(3);
    expect(options[0]).toHaveTextContent('Select a template');
    expect(options[1]).toHaveTextContent('Blog Post');
    expect(options[2]).toHaveTextContent('Product Card');
  });

  it('filters out deprecated templates', async () => {
    renderField(mockContext, '', vi.fn());

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    expect(screen.queryByText('Old Layout')).not.toBeInTheDocument();
  });

  it('calls onChange with the selected template ID', async () => {
    const onChange = vi.fn();
    renderField(mockContext, '', onChange);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'tmpl-2' } });

    expect(onChange).toHaveBeenCalledWith('tmpl-2');
  });

  it('reflects the current value as the selected option', async () => {
    renderField(mockContext, 'tmpl-1', vi.fn());

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('tmpl-1');
  });

  it('disables the select when readOnly is true', async () => {
    renderField(mockContext, '', vi.fn(), true);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    expect(select).toBeDisabled();
  });

  it('shows empty state when no templates exist', async () => {
    mockContext = createMockContext([]);
    renderField(mockContext, '', vi.fn());

    await waitFor(() => {
      expect(screen.getByText('No templates available')).toBeInTheDocument();
    });
  });
});
