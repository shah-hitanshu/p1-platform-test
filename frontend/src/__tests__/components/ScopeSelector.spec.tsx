/**
 * ScopeSelector Component Tests (TDD - Red Phase)
 *
 * Tests for the ScopeSelector component that allows users to select
 * API token scopes with supersession and minimum-selection logic.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScopeSelector } from '../../components/ScopeSelector';

describe('ScopeSelector', () => {
  it('should render all three scope checkboxes with correct labels', () => {
    const onChange = vi.fn();
    render(<ScopeSelector selectedScopes={['read:published']} onChange={onChange} />);

    expect(screen.getByLabelText('Published content (main branch only)')).toBeInTheDocument();
    expect(screen.getByLabelText('All branch content')).toBeInTheDocument();
    expect(screen.getByLabelText('Draft data (editor API)')).toBeInTheDocument();
  });

  it('should show published checked when selectedScopes includes read:published', () => {
    const onChange = vi.fn();
    render(<ScopeSelector selectedScopes={['read:published']} onChange={onChange} />);

    expect(screen.getByLabelText('Published content (main branch only)')).toBeChecked();
    expect(screen.getByLabelText('All branch content')).not.toBeChecked();
    expect(screen.getByLabelText('Draft data (editor API)')).not.toBeChecked();
  });

  it('should uncheck read:published when read:all is selected (supersession)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ScopeSelector selectedScopes={['read:published']} onChange={onChange} />);

    await user.click(screen.getByLabelText('All branch content'));

    // read:all supersedes read:published, so callback should only contain read:all
    expect(onChange).toHaveBeenCalledWith(['read:all']);
  });

  it('should not allow unchecking the last remaining scope', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ScopeSelector selectedScopes={['read:published']} onChange={onChange} />);

    // Try to uncheck the only selected scope
    await user.click(screen.getByLabelText('Published content (main branch only)'));

    // onChange should not be called since we can't deselect the last scope
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should call onChange with expected scope array when a scope is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ScopeSelector selectedScopes={['read:published']} onChange={onChange} />);

    await user.click(screen.getByLabelText('Draft data (editor API)'));

    expect(onChange).toHaveBeenCalledWith(['read:published', 'read:draft']);
  });

  it('should show informational note when read:draft is selected', () => {
    const onChange = vi.fn();
    render(<ScopeSelector selectedScopes={['read:draft']} onChange={onChange} />);

    expect(screen.getByTestId('draft-scope-note')).toBeInTheDocument();
    expect(screen.getByTestId('draft-scope-note')).toHaveTextContent(/full access/i);
  });

  it('should not show draft informational note when read:draft is not selected', () => {
    const onChange = vi.fn();
    render(<ScopeSelector selectedScopes={['read:published']} onChange={onChange} />);

    expect(screen.queryByTestId('draft-scope-note')).not.toBeInTheDocument();
  });

  it('should allow multiple scopes to be selected (read:all + read:draft)', () => {
    const onChange = vi.fn();
    render(<ScopeSelector selectedScopes={['read:all', 'read:draft']} onChange={onChange} />);

    expect(screen.getByLabelText('All branch content')).toBeChecked();
    expect(screen.getByLabelText('Draft data (editor API)')).toBeChecked();
    // read:published should not be checked since read:all supersedes it
    expect(screen.getByLabelText('Published content (main branch only)')).not.toBeChecked();
  });
});
