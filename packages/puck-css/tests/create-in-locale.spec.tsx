/**
 * Creating a page in a locale
 *
 * A page can be created carrying a market of its own, and an existing page can
 * be brought into a market as a version hanging off it. The first is a page like
 * any other that happens to declare a locale; the second is a translation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import type { P1Client, Branch, PuckData } from '@pantheon-systems/css-client';

vi.mock('../src/editor/useRealtime.js', () => ({
  useRealtime: () => ({
    connected: false,
    applyLocalChange: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(null),
    error: null,
    sendFocusRegions: vi.fn().mockReturnValue(false),
    sendHeartbeat: vi.fn(),
    presenceViaWebSocket: false,
    connectedDocumentPath: null,
  }),
}));

const { P1PuckProvider } = await import('../src/editor/P1PuckProvider.js');
const { useP1Puck } = await import('../src/core/P1PuckContext.js');

const mainBranch: Branch = {
  id: 'branch-1',
  siteId: 'site-1',
  name: 'main',
  isMain: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const canonical = {
  id: 'doc-pricing',
  siteId: 'site-1',
  path: 'pricing',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const emptySnapshot: PuckData = { content: [], root: { props: {} } };

function createMockClient(): P1Client {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([mainBranch]),
      get: vi.fn().mockResolvedValue(mainBranch),
    },
    documents: {
      list: vi.fn().mockResolvedValue([canonical]),
      getByPath: vi.fn().mockResolvedValue(canonical),
      create: vi.fn().mockResolvedValue({ ...canonical, id: 'doc-new', path: 'preise' }),
      delete: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      getLatest: vi.fn().mockResolvedValue({
        id: 'v1',
        versionNumber: 1,
        snapshot: emptySnapshot,
        createdAt: '2026-01-01T00:00:00Z',
      }),
      create: vi.fn(),
    },
    translations: {
      create: vi.fn().mockResolvedValue({
        document: { ...canonical, id: 'doc-de', path: 'pricing.de-DE', locale: 'de-DE' },
        version: { id: 'v1', versionNumber: 1 },
        localization: { canonicalDocumentId: 'doc-pricing', localeDocumentId: 'doc-de' },
      }),
      listVariants: vi.fn().mockResolvedValue({ canonical, variants: [] }),
    },
    checkpoints: { list: vi.fn().mockResolvedValue([]), create: vi.fn() },
    presence: {
      getSitePresence: vi.fn(),
      getBranchPresence: vi.fn(),
      getAgentPresence: vi.fn(),
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as P1Client;
}

function wrapperFor(client: P1Client) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1PuckProvider,
      { client, siteId: 'site-1', branchId: 'branch-1', userId: 'user-1' },
      children,
    );
  };
}

describe('creating a page in a locale', () => {
  let client: P1Client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
  });

  async function contextFor(c: P1Client) {
    const { result } = renderHook(() => useP1Puck(), { wrapper: wrapperFor(c) });
    await waitFor(() => {
      expect(result.current.branchId).toBe('branch-1');
    });
    return result;
  }

  it('tags the new page with the market it was created in', async () => {
    const result = await contextFor(client);

    await act(async () => {
      await result.current.createDocument('preise', null, 'Preise', 'de-DE');
    });

    expect(client.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'preise', locale: 'de-DE' }),
    );
  });

  it('leaves a page untagged when no market was chosen', async () => {
    const result = await contextFor(client);

    await act(async () => {
      await result.current.createDocument('preise', null, 'Preise');
    });

    const params = (client.documents.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(params).not.toHaveProperty('locale');
  });

  it('hangs a locale version off the page it translates', async () => {
    const result = await contextFor(client);

    await act(async () => {
      await result.current.createTranslation({
        canonicalDocumentId: 'doc-pricing',
        locale: 'de-DE',
        mode: 'copy',
      });
    });

    expect(client.translations.create).toHaveBeenCalledWith({
      siteId: 'site-1',
      branchId: 'branch-1',
      canonicalDocumentId: 'doc-pricing',
      locale: 'de-DE',
      mode: 'copy',
    });
  });

  it('lists the new locale version with the branch’s other pages', async () => {
    const result = await contextFor(client);
    const listsBefore = (client.documents.list as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => {
      await result.current.createTranslation({
        canonicalDocumentId: 'doc-pricing',
        locale: 'de-DE',
      });
    });

    expect((client.documents.list as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      listsBefore,
    );
  });

  it('takes the server’s seeding default when no mode is named', async () => {
    const result = await contextFor(client);

    await act(async () => {
      await result.current.createTranslation({
        canonicalDocumentId: 'doc-pricing',
        locale: 'de-DE',
      });
    });

    const params = (client.translations.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(params).not.toHaveProperty('mode');
  });
});
