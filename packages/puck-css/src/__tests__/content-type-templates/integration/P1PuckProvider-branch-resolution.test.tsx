/**
 * Which branch the editor's templates fetch targets, and that it never targets none.
 *
 * An empty branch segment produced `/branches//templates`, which the API read as the
 * branch literally named "templates".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import type { P1Client } from '@pantheon-systems/css-client';
import { P1PuckProvider } from '../../../editor/P1PuckProvider.js';
import { useP1Puck } from '../../../core/P1PuckContext.js';
import { useNotifications } from '../../../core/NotificationContext.js';

describe('P1PuckProvider - branch resolution on the templates path', () => {
  let mockClient: P1Client;
  let listBranches: ReturnType<typeof vi.fn>;
  let listTemplates: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    listBranches = vi.fn().mockResolvedValue([
      { id: 'branch-main-uuid', name: 'main', isMain: true },
      { id: 'branch-feature-uuid', name: 'feature-x', isMain: false },
    ]);
    listTemplates = vi.fn().mockResolvedValue([]);

    const baseMockClient = {
      sites: { get: vi.fn().mockResolvedValue({ id: 'site-1', name: 'Test Site' }) },
      branches: { list: listBranches },
      documents: { list: vi.fn().mockResolvedValue([]) },
      templates: { list: listTemplates },
      presence: { getBranchPresence: vi.fn().mockResolvedValue({ actors: [], documents: [] }) },
      withPrincipal: vi.fn(),
    };
    baseMockClient.withPrincipal.mockReturnValue(baseMockClient);
    mockClient = baseMockClient as unknown as P1Client;
  });

  function render(branchId: string) {
    // P1PuckProvider mounts NotificationProvider, so a child hook sees the same state.
    return renderHook(() => ({ ccr: useP1Puck(), notes: useNotifications() }), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId={branchId}
          userId="user-1"
          userRole="editor"
          enableRealtime={false}
          presenceEnabled={false}
        >
          {children}
        </P1PuckProvider>
      ),
    });
  }

  it('uses the configured branch for the templates fetch', async () => {
    render('feature-x');

    await waitFor(() => {
      expect(listTemplates).toHaveBeenCalledWith('site-1', 'feature-x');
    });
  });

  it('resolves to the main branch when the configured branch is the literal "main"', async () => {
    render('main');

    await waitFor(() => {
      expect(listTemplates).toHaveBeenCalledWith('site-1', 'branch-main-uuid');
    });
    expect(listTemplates).not.toHaveBeenCalledWith('site-1', '');
  });

  it('never fetches templates with an empty branch while none is resolved', async () => {
    render('');

    await waitFor(() => {
      expect(listBranches).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(listTemplates).toHaveBeenCalledWith('site-1', 'branch-main-uuid');
    });
    expect(listTemplates).not.toHaveBeenCalledWith('site-1', '');
  });

  it('never fetches templates with an empty branch when the branch list fails', async () => {
    listBranches.mockRejectedValue(new Error('Forbidden'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = render('');

    await waitFor(() => {
      expect(result.current.ccr.branchesLoading).toBe(false);
    });
    expect(listTemplates).not.toHaveBeenCalled();
  });

  // Nothing else can load without a branch — useDocuments' fetch is branch-guarded, so
  // documentsLoading never clears and the editor sits blank. It has to say why.
  it('surfaces a failed branch list instead of failing silently', async () => {
    listBranches.mockRejectedValue(new Error('Forbidden'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = render('');

    await waitFor(() => {
      expect(result.current.ccr.branchesLoading).toBe(false);
    });
    await waitFor(() => {
      expect(
        result.current.notes.notifications.some((n) =>
          n.message.includes('Failed to load branches'),
        ),
      ).toBe(true);
    });
  });

  // Regression: routing the `main` fallback through the same prop as an explicit
  // configuration made `initialBranchId` always truthy, so the provider stopped reading
  // the branch the user had switched to and then overwrote it with main.
  it('restores the branch the user switched to when nothing is configured', async () => {
    sessionStorage.setItem('ccr-branch-site-1', 'branch-feature-uuid');

    render('');

    await waitFor(() => {
      expect(listTemplates).toHaveBeenCalledWith('site-1', 'branch-feature-uuid');
    });
    expect(listTemplates).not.toHaveBeenCalledWith('site-1', 'branch-main-uuid');
    expect(sessionStorage.getItem('ccr-branch-site-1')).toBe('branch-feature-uuid');
  });

  it('migrates a branch persisted under the pre-rename css-branch key', async () => {
    sessionStorage.setItem('css-branch-site-1', 'branch-feature-uuid');

    render('');

    await waitFor(() => {
      expect(listTemplates).toHaveBeenCalledWith('site-1', 'branch-feature-uuid');
    });
    expect(sessionStorage.getItem('ccr-branch-site-1')).toBe('branch-feature-uuid');
    expect(sessionStorage.getItem('css-branch-site-1')).toBeNull();
  });

  it('lets an explicitly configured branch outrank the persisted one', async () => {
    sessionStorage.setItem('ccr-branch-site-1', 'branch-feature-uuid');

    render('main');

    await waitFor(() => {
      expect(listTemplates).toHaveBeenCalledWith('site-1', 'branch-main-uuid');
    });
  });

});
