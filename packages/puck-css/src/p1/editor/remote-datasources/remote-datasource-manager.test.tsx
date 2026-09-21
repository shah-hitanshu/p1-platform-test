/// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const { saveMutate, removeMutate } = vi.hoisted(() => ({
  saveMutate: vi.fn(),
  removeMutate: vi.fn(),
}));

let mockPermissions: { canEditDocuments: boolean } | null = null;

vi.mock('../hooks/api-hooks', () => ({
  useRemoteDatasources: () => ({
    data: {
      global: [],
      page: [
        {
          id: 'products',
          label: 'Products',
          description: '',
          urlTemplate: 'https://example.com/products',
          fields: [],
          headers: {},
          query: {},
        },
      ],
    },
  }),
  useSaveRemoteDatasource: () => ({ mutate: saveMutate, error: null }),
  useRemoveRemoteDatasource: () => ({ mutate: removeMutate }),
}));

vi.mock('../../../core/P1PuckContext.js', () => ({
  useP1PuckOptional: () => ({ permissions: mockPermissions }),
}));

import { RemoteDatasourceManager } from './remote-datasource-manager';

describe('RemoteDatasourceManager read-only gating', () => {
  beforeEach(() => {
    mockPermissions = null;
    saveMutate.mockReset();
    removeMutate.mockReset();
    cleanup();
  });

  it('disables Save and Delete and explains why for a role that cannot edit documents', () => {
    mockPermissions = { canEditDocuments: false };
    render(<RemoteDatasourceManager editorPath="/" />);

    const save = screen.getByRole('button', { name: 'Save datasource' }) as HTMLButtonElement;
    const del = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(del.disabled).toBe(true);
    expect(save.title).toMatch(/view-only access/i);
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument();

    fireEvent.click(save);
    fireEvent.click(del);
    expect(saveMutate).not.toHaveBeenCalled();
    expect(removeMutate).not.toHaveBeenCalled();
  });

  it('leaves Save and Delete usable for a role that can edit documents', () => {
    mockPermissions = { canEditDocuments: true };
    render(<RemoteDatasourceManager editorPath="/" />);

    expect((screen.getByRole('button', { name: 'Save datasource' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/view-only access/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(removeMutate).toHaveBeenCalledWith({ scope: 'page', path: '/', id: 'products' });
  });

  it('stays usable when no permissions have been resolved', () => {
    render(<RemoteDatasourceManager editorPath="/" />);
    expect((screen.getByRole('button', { name: 'Save datasource' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
