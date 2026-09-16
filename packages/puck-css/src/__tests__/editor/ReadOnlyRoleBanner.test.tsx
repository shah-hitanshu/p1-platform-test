import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

let mockPerms: { canEditDocuments: boolean } | null = null;

vi.mock('../../core/P1PuckContext', () => ({
  useP1Puck: () => ({ permissions: mockPerms }),
}));

import { ReadOnlyRoleBanner } from '../../editor/components/ReadOnlyRoleBanner';

describe('ReadOnlyRoleBanner', () => {
  it('renders nothing when permissions is absent', () => {
    mockPerms = null;
    const { container } = render(<ReadOnlyRoleBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the role can edit documents', () => {
    mockPerms = { canEditDocuments: true };
    const { container } = render(<ReadOnlyRoleBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the read-only notice when the role cannot edit documents', () => {
    mockPerms = { canEditDocuments: false };
    render(<ReadOnlyRoleBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('You are viewing this page in read-only mode.')).toBeInTheDocument();
  });
});
