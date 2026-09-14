/**
 * Authority Toggle Tests
 *
 * A per-prop toggle on a translation. Off means the prop inherits from the
 * canonical page; on means this language owns it and edits it here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { AuthorityToggle } from '../../features/localization/ui/AuthorityToggle.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthorityToggle', () => {
  it('reads off while the prop inherits', () => {
    render(<AuthorityToggle broken={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId('loc-authority-toggle')).not.toBeChecked();
  });

  it('reads on while the translation owns the prop', () => {
    render(<AuthorityToggle broken={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('loc-authority-toggle')).toBeChecked();
  });

  it('calls onToggle with true when switched on', () => {
    const onToggle = vi.fn();
    render(<AuthorityToggle broken={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('calls onToggle with false when switched back off', () => {
    const onToggle = vi.fn();
    render(<AuthorityToggle broken={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('does not call onToggle when read-only', () => {
    const onToggle = vi.fn();
    render(<AuthorityToggle broken={false} onToggle={onToggle} readOnly />);
    fireEvent.click(screen.getByTestId('loc-authority-toggle'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
