/**
 * Phase 1: Content-Oriented Diff Viewer - ContentChangeRow Tests (TDD)
 *
 * Tests for the ContentChangeRow component that displays a single field change
 * in "Field: ~~old~~ -> new" format with color coding.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentChangeRow } from '../../components/content-diff/ContentChangeRow';
import type { ContentChange } from '../../components/content-diff/types';

describe('ContentChangeRow', () => {
  it('should render a replace change with label, old value and new value', () => {
    const change: ContentChange = {
      type: 'replace',
      path: '/title',
      label: 'Title',
      oldValue: 'Old Title',
      newValue: 'New Title',
    };

    render(<ContentChangeRow change={change} />);

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Old Title')).toBeInTheDocument();
    expect(screen.getByText('New Title')).toBeInTheDocument();
  });

  it('should render an add change with only new value', () => {
    const change: ContentChange = {
      type: 'add',
      path: '/subtitle',
      label: 'Subtitle',
      newValue: 'New Subtitle',
    };

    render(<ContentChangeRow change={change} />);

    expect(screen.getByText('Subtitle')).toBeInTheDocument();
    expect(screen.getByText('New Subtitle')).toBeInTheDocument();
  });

  it('should render a remove change with only old value', () => {
    const change: ContentChange = {
      type: 'remove',
      path: '/description',
      label: 'Description',
      oldValue: 'Removed text',
    };

    render(<ContentChangeRow change={change} />);

    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Removed text')).toBeInTheDocument();
  });

  it('should apply correct CSS class for add change type', () => {
    const change: ContentChange = {
      type: 'add',
      path: '/field',
      label: 'Field',
      newValue: 'val',
    };

    const { container } = render(<ContentChangeRow change={change} />);
    const row = container.querySelector('.content-change-row');
    expect(row).toHaveClass('change-add');
  });

  it('should apply correct CSS class for remove change type', () => {
    const change: ContentChange = {
      type: 'remove',
      path: '/field',
      label: 'Field',
      oldValue: 'val',
    };

    const { container } = render(<ContentChangeRow change={change} />);
    const row = container.querySelector('.content-change-row');
    expect(row).toHaveClass('change-remove');
  });

  it('should apply correct CSS class for replace change type', () => {
    const change: ContentChange = {
      type: 'replace',
      path: '/field',
      label: 'Field',
      oldValue: 'old',
      newValue: 'new',
    };

    const { container } = render(<ContentChangeRow change={change} />);
    const row = container.querySelector('.content-change-row');
    expect(row).toHaveClass('change-replace');
  });

  it('should display object values as JSON string', () => {
    const change: ContentChange = {
      type: 'replace',
      path: '/config',
      label: 'Config',
      oldValue: { key: 'old' },
      newValue: { key: 'new' },
    };

    render(<ContentChangeRow change={change} />);

    // Should render JSON stringified values
    expect(screen.getByText(/old/)).toBeInTheDocument();
    expect(screen.getByText(/new/)).toBeInTheDocument();
  });

  it('should handle boolean values', () => {
    const change: ContentChange = {
      type: 'replace',
      path: '/published',
      label: 'Published',
      oldValue: false,
      newValue: true,
    };

    render(<ContentChangeRow change={change} />);

    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('should handle numeric values', () => {
    const change: ContentChange = {
      type: 'replace',
      path: '/count',
      label: 'Count',
      oldValue: 5,
      newValue: 10,
    };

    render(<ContentChangeRow change={change} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
