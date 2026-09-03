/**
 * Translatability Toggle Tests
 *
 * A per-prop toggle marking whether a prop is natural-language text worth
 * translating. Default ON; toggling OFF marks it non-translatable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { TranslatabilityToggle } from '../../features/localization/ui/TranslatabilityToggle.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TranslatabilityToggle', () => {
  it('defaults to on (checked) when translatable is true', () => {
    render(<TranslatabilityToggle translatable={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('loc-translatable-toggle')).toBeChecked();
  });

  it('reflects a stored false as off (unchecked)', () => {
    render(<TranslatabilityToggle translatable={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId('loc-translatable-toggle')).not.toBeChecked();
  });

  it('calls onToggle with false when switched off', () => {
    const onToggle = vi.fn();
    render(<TranslatabilityToggle translatable={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('loc-translatable-toggle'));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('calls onToggle with true when switched back on', () => {
    const onToggle = vi.fn();
    render(<TranslatabilityToggle translatable={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('loc-translatable-toggle'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('does not call onToggle when read-only', () => {
    const onToggle = vi.fn();
    render(<TranslatabilityToggle translatable={true} onToggle={onToggle} readOnly />);
    fireEvent.click(screen.getByTestId('loc-translatable-toggle'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
