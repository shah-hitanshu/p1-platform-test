/**
 * useComponentRegistry Hook Tests
 *
 * Tests for the hook that syncs Puck component config to CSS registry documents.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { CSSPuckContext } from '../CSSPuckContext.js';
import type { CSSPuckContextValue } from '../types.js';
import { useComponentRegistry } from '../hooks/useComponentRegistry.js';

// Build a minimal mock context
function makeMockContext(overrides?: Partial<CSSPuckContextValue>): CSSPuckContextValue {
  const mockClient = {
    documents: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'doc-new', path: '/_registry/components/HeroBlock' }),
    },
    versions: {
      getLatest: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'ver-1', versionNumber: 1, snapshot: {} }),
    },
  };
  return {
    client: mockClient as unknown as import('@pantheon/css-client').CSSClient,
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument: null,
    currentData: null,
    saveStatus: 'idle',
    lastSaved: null,
    saveError: null,
    loadDocument: vi.fn(),
    saveData: vi.fn(),
    notifications: {
      add: vi.fn(),
      remove: vi.fn(),
      notifications: [],
    },
    switchBranch: vi.fn(),
    ...overrides,
  } as unknown as CSSPuckContextValue;
}

function wrapper(ctx: CSSPuckContextValue) {
  return ({ children }: { children: React.ReactNode }) => (
    <CSSPuckContext.Provider value={ctx}>{children}</CSSPuckContext.Provider>
  );
}

const simplePuckConfig = {
  components: {
    HeroBlock: {
      label: 'Hero',
      fields: { title: { type: 'text', label: 'Title' } },
      defaultProps: { title: '' },
    },
  },
};

const twoComponentConfig = {
  components: {
    HeroBlock: {
      label: 'Hero',
      fields: { title: { type: 'text', label: 'Title' } },
      defaultProps: { title: '' },
    },
    CardBlock: {
      label: 'Card',
      fields: { body: { type: 'textarea', label: 'Body' } },
      defaultProps: { body: '' },
    },
  },
};

describe('useComponentRegistry', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns status "registered" after a successful run', async () => {
    const ctx = makeMockContext();
    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));
    expect(result.current.error).toBeNull();
  });

  it('creates a new document and version when no existing registry doc for a component', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    // No existing docs at prefix
    mockClient.documents.list.mockResolvedValue([]);
    mockClient.documents.create.mockResolvedValue({ id: 'doc-hero', path: '/_registry/components/HeroBlock' });

    renderHook(() => useComponentRegistry({ puckConfig: simplePuckConfig }), { wrapper: wrapper(ctx) });

    await waitFor(() => expect(mockClient.documents.create).toHaveBeenCalled());

    // Should create the component doc
    expect(mockClient.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/_registry/components/HeroBlock' }),
    );
    // Should create a version
    expect(mockClient.versions.create).toHaveBeenCalled();
  });

  it('skips write when stored hash matches computed hash', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    // Compute what the actual hash would be for our mock config
    const { extractDescriptors } = await import('../utils/componentRegistry.js');
    const [descriptor] = extractDescriptors(simplePuckConfig);
    const storedHash = descriptor.descriptorHash;

    // Return existing doc with matching hash
    mockClient.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '/_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '/_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    mockClient.versions.getLatest.mockResolvedValue({
      id: 'ver-1', versionNumber: 1,
      snapshot: { ...descriptor, descriptorHash: storedHash },
    });

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));

    // No new versions should be created: hashes match, so neither component nor index is written.
    expect(mockClient.versions.create).not.toHaveBeenCalled();
    // Test plan Test 2: assert skipped and registered counts
    expect(result.current.result?.skipped).toBe(1);
    expect(result.current.result?.registered).toBe(0);
  });

  it('writes a new version when stored hash differs', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    mockClient.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '/_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    // Stored snapshot has a different hash
    mockClient.versions.getLatest.mockResolvedValue({
      id: 'ver-old', versionNumber: 1,
      snapshot: { name: 'HeroBlock', descriptorHash: 'stale-hash-000' },
    });

    renderHook(() => useComponentRegistry({ puckConfig: simplePuckConfig }), { wrapper: wrapper(ctx) });

    await waitFor(() => {
      const calls = mockClient.versions.create.mock.calls as unknown[][];
      return calls.some((args) => {
        const params = args[1] as Record<string, string>;
        return params.documentId === 'doc-hero';
      });
    });

    const calls = mockClient.versions.create.mock.calls as unknown[][];
    const heroCall = calls.find((args) => {
      const params = args[1] as Record<string, string>;
      return params.documentId === 'doc-hero';
    });
    expect(heroCall).toBeDefined();
  });

  it('returns status "error" and non-null error when CSS write fails', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    mockClient.documents.list.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('calls onRegistered callback with counts', async () => {
    const ctx = makeMockContext();
    const onRegistered = vi.fn();

    renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig, onRegistered }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(onRegistered).toHaveBeenCalled());
    const [result] = onRegistered.mock.calls[0] as [{ registered: number; skipped: number; total: number }][];
    expect(result.total).toBe(1);
    expect(typeof result.registered).toBe('number');
    expect(typeof result.skipped).toBe('number');
  });

  // Test 1: Full registration flow with two components
  it('registers all components and index when registry is empty (total === 2, registered === 2)', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    mockClient.documents.list.mockResolvedValue([]);
    let docCounter = 0;
    mockClient.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${++docCounter}`, path }),
    );
    mockClient.versions.create.mockResolvedValue({ id: 'ver-1', versionNumber: 1, snapshot: {} });

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: twoComponentConfig }),
      { wrapper: wrapper(ctx) },
    );

    // Test plan Test 1: hook must transition through 'registering' before reaching 'registered'
    await waitFor(() => expect(result.current.status).toBe('registering'));
    await waitFor(() => expect(result.current.status).toBe('registered'));

    // total === 2 (two named components, no root in twoComponentConfig)
    expect(result.current.result?.total).toBe(2);
    expect(result.current.result?.registered).toBe(2);
    // Test plan Test 1: skipped === 0 (all components are new)
    expect(result.current.result?.skipped).toBe(0);
    expect(result.current.error).toBeNull();

    // Should create docs for both components and the index
    const createCalls = mockClient.documents.create.mock.calls as { path: string }[][];
    const createdPaths = createCalls.map((args) => args[0].path);
    expect(createdPaths).toContain('/_registry/components/HeroBlock');
    expect(createdPaths).toContain('/_registry/components/CardBlock');
    expect(createdPaths).toContain('/_registry/index');

    // versions.create called at least 3 times (2 components + 1 index)
    expect(mockClient.versions.create.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // Test 3: Component field change triggers version write but NOT documents.create for the component
  it('writes new version on existing doc when hash differs — does not call documents.create for component', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    mockClient.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '/_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    // Stale hash — triggers write
    mockClient.versions.getLatest.mockResolvedValue({
      id: 'ver-old', versionNumber: 1,
      snapshot: { name: 'HeroBlock', descriptorHash: 'stale-hash-000' },
    });
    // Index doc does not exist yet, so documents.create should only be called for the index
    mockClient.documents.create.mockResolvedValue({ id: 'doc-index', path: '/_registry/index' });

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));

    // documents.create must NOT be called for the component (doc already exists)
    const createCalls = mockClient.documents.create.mock.calls as { path: string }[][];
    const componentCreateCalls = createCalls.filter((args) => args[0].path.startsWith('/_registry/components/'));
    expect(componentCreateCalls).toHaveLength(0);

    // documents.create IS called for the index (it doesn't exist yet)
    const indexCreateCalls = createCalls.filter((args) => args[0].path === '/_registry/index');
    expect(indexCreateCalls).toHaveLength(1);

    // versions.create called with the existing doc's UUID for the component
    const versionCalls = mockClient.versions.create.mock.calls as unknown[][];
    const heroVersionCall = versionCalls.find((args) => {
      const params = args[1] as Record<string, string>;
      return params.documentId === 'doc-hero';
    });
    expect(heroVersionCall).toBeDefined();
  });

  // Test 6: Snapshot content validation — full ComponentDescriptor shape written to CSS
  it('writes a valid ComponentDescriptor snapshot with all required fields', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    mockClient.documents.list.mockResolvedValue([]);
    mockClient.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path }),
    );

    // Capture all snapshot arguments passed to versions.create
    const versionCreateCalls: Array<{ documentId: string; snapshot: unknown }> = [];
    mockClient.versions.create.mockImplementation(
      (_siteId: string, params: { documentId: string; branchId: string; snapshot: unknown }) => {
        versionCreateCalls.push({ documentId: params.documentId, snapshot: params.snapshot });
        return Promise.resolve({ id: 'ver-1', versionNumber: 1, snapshot: params.snapshot });
      },
    );

    // Config with a select field, defaultProps, and ai.instructions
    const configWithAllFields = {
      components: {
        FeatureCard: {
          label: 'Feature Card',
          fields: {
            variant: {
              type: 'select',
              label: 'Variant',
              options: [
                { label: 'Primary', value: 'primary' },
                { label: 'Secondary', value: 'secondary' },
              ],
            },
          },
          defaultProps: { variant: 'primary' },
          ai: { instructions: 'Use for feature highlights on landing pages.' },
        },
      },
    };

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: configWithAllFields }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));

    // Find the version create call for the component doc (not the index)
    const componentCall = versionCreateCalls.find(
      (c) => (c.snapshot as Record<string, unknown>)?.name === 'FeatureCard',
    );
    expect(componentCall).toBeDefined();

    const snapshot = componentCall!.snapshot as Record<string, unknown>;

    // name matches the component key
    expect(snapshot.name).toBe('FeatureCard');

    // fields contains exactly one entry of type 'select' with correct options
    const fields = snapshot.fields as Array<Record<string, unknown>>;
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('select');
    expect(fields[0].name).toBe('variant');
    expect(fields[0].label).toBe('Variant');
    const options = fields[0].options as Array<{ label: string; value: string }>;
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ label: 'Primary', value: 'primary' });
    expect(options[1]).toEqual({ label: 'Secondary', value: 'secondary' });

    // defaultProps matches the config
    expect(snapshot.defaultProps).toEqual({ variant: 'primary' });

    // ai.instructions matches the config
    const ai = snapshot.ai as Record<string, unknown>;
    expect(ai.instructions).toBe('Use for feature highlights on landing pages.');

    // descriptorHash is a non-empty hex string
    expect(typeof snapshot.descriptorHash).toBe('string');
    expect((snapshot.descriptorHash as string).length).toBeGreaterThan(0);
    expect(/^[0-9a-f]+$/.test(snapshot.descriptorHash as string)).toBe(true);

    // provenance is 'site' (no upstream config provided)
    expect(snapshot.provenance).toBe('site');

    // registeredAt matches ISO 8601
    expect(typeof snapshot.registeredAt).toBe('string');
    expect(/^\d{4}-\d{2}-\d{2}T/.test(snapshot.registeredAt as string)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fast-path tests: hashes stored in registry index (new behaviour)
  // -------------------------------------------------------------------------

  it('fast path: reads hashes from index, makes no per-component getLatest calls', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    const { extractDescriptors } = await import('../utils/componentRegistry.js');
    const [descriptor] = extractDescriptors(simplePuckConfig);
    const currentHash = descriptor.descriptorHash;

    // Both component doc and index doc exist (paths match what the code creates — no leading slash)
    mockClient.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);

    // Index version contains the hashes map (fast path format)
    mockClient.versions.getLatest.mockImplementation(
      (_siteId: string, _branchId: string, docId: string) => {
        if (docId === 'doc-index') {
          return Promise.resolve({
            id: 'ver-index', versionNumber: 1,
            snapshot: {
              siteId: 'site-1', branchId: 'branch-1',
              componentNames: ['HeroBlock'],
              provenance: { HeroBlock: 'site' },
              updatedAt: new Date().toISOString(),
              hashes: { HeroBlock: currentHash },
            },
          });
        }
        // Should never be called for component docs in the fast path
        return Promise.resolve({ id: 'ver-hero', versionNumber: 1, snapshot: {} });
      },
    );

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));

    // getLatest called exactly once — for the index, not for individual components
    expect(mockClient.versions.getLatest).toHaveBeenCalledTimes(1);
    expect(mockClient.versions.getLatest).toHaveBeenCalledWith('site-1', 'branch-1', 'doc-index');

    // Hash matches — nothing written
    expect(mockClient.versions.create).not.toHaveBeenCalled();
    expect(result.current.result?.skipped).toBe(1);
    expect(result.current.result?.registered).toBe(0);
  });

  it('fast path: writes only the changed component when its hash differs in the index', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    const { extractDescriptors } = await import('../utils/componentRegistry.js');
    const descriptors = extractDescriptors(twoComponentConfig);
    const heroDescriptor = descriptors.find((d) => d.name === 'HeroBlock')!;
    const cardDescriptor = descriptors.find((d) => d.name === 'CardBlock')!;

    mockClient.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-card', path: '_registry/components/CardBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);

    // Index has stale hash for HeroBlock, current hash for CardBlock
    mockClient.versions.getLatest.mockImplementation(
      (_siteId: string, _branchId: string, docId: string) => {
        if (docId === 'doc-index') {
          return Promise.resolve({
            id: 'ver-index', versionNumber: 1,
            snapshot: {
              siteId: 'site-1', branchId: 'branch-1',
              componentNames: ['HeroBlock', 'CardBlock'],
              provenance: { HeroBlock: 'site', CardBlock: 'site' },
              updatedAt: new Date().toISOString(),
              hashes: {
                HeroBlock: 'stale-hash-000',
                CardBlock: cardDescriptor.descriptorHash,
              },
            },
          });
        }
        return Promise.resolve({ id: 'ver', versionNumber: 1, snapshot: {} });
      },
    );
    mockClient.versions.create.mockResolvedValue({ id: 'ver-new', versionNumber: 2, snapshot: {} });

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: twoComponentConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));

    // getLatest called exactly once (for index only)
    expect(mockClient.versions.getLatest).toHaveBeenCalledTimes(1);
    expect(mockClient.versions.getLatest).toHaveBeenCalledWith('site-1', 'branch-1', 'doc-index');

    // Only HeroBlock is registered (stale), CardBlock is skipped (current)
    expect(result.current.result?.registered).toBe(1);
    expect(result.current.result?.skipped).toBe(1);

    // versions.create called for HeroBlock and the updated index (not CardBlock)
    const createCalls = mockClient.versions.create.mock.calls as unknown[][];
    const docIds = createCalls.map((args) => (args[1] as Record<string, string>).documentId);
    expect(docIds).toContain('doc-hero');
    expect(docIds).not.toContain('doc-card');
    // Index must also be updated
    expect(docIds).toContain('doc-index');

    // The index snapshot written must include updated hashes for both components
    const indexWriteCall = createCalls.find(
      (args) => (args[1] as Record<string, string>).documentId === 'doc-index',
    );
    const indexSnapshot = (indexWriteCall![1] as Record<string, unknown>).snapshot as Record<string, unknown>;
    const writtenHashes = indexSnapshot.hashes as Record<string, string>;
    expect(writtenHashes.HeroBlock).toBe(heroDescriptor.descriptorHash);
    expect(writtenHashes.CardBlock).toBe(cardDescriptor.descriptorHash);
  });

  it('fast path: written index includes hashes field enabling future fast-path runs', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    // Fresh registry — no docs exist
    mockClient.documents.list.mockResolvedValue([]);
    let docCounter = 0;
    mockClient.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${++docCounter}`, path }),
    );

    const capturedSnapshots: Array<{ documentId: string; snapshot: unknown }> = [];
    mockClient.versions.create.mockImplementation(
      (_siteId: string, params: { documentId: string; branchId: string; snapshot: unknown }) => {
        capturedSnapshots.push({ documentId: params.documentId, snapshot: params.snapshot });
        return Promise.resolve({ id: 'ver-1', versionNumber: 1, snapshot: params.snapshot });
      },
    );

    const { extractDescriptors } = await import('../utils/componentRegistry.js');
    const [descriptor] = extractDescriptors(simplePuckConfig);

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));

    // Find the index write call
    const indexWrite = capturedSnapshots.find(
      (c) => (c.snapshot as Record<string, unknown>)?.componentNames !== undefined,
    );
    expect(indexWrite).toBeDefined();

    const indexSnapshot = indexWrite!.snapshot as Record<string, unknown>;
    expect(indexSnapshot.hashes).toBeDefined();

    const hashes = indexSnapshot.hashes as Record<string, string>;
    expect(hashes.HeroBlock).toBe(descriptor.descriptorHash);
  });

  it('fast path: promotes legacy index (no hashes field) to include hashes even when nothing changed', async () => {
    // Regression test for: legacy index exists, all hashes match via per-component fetch,
    // registered === 0 — index MUST still be written to add the hashes field so future
    // startups can use the fast path (1 request) instead of the legacy path (N requests).
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    const { extractDescriptors } = await import('../utils/componentRegistry.js');
    const [descriptor] = extractDescriptors(simplePuckConfig);
    const currentHash = descriptor.descriptorHash;

    // Index exists but has NO hashes field (legacy format)
    mockClient.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);

    // Index version has no hashes field (legacy format) — forces legacy per-component fetch
    mockClient.versions.getLatest.mockImplementation(
      (_siteId: string, _branchId: string, docId: string) => {
        if (docId === 'doc-index') {
          return Promise.resolve({
            id: 'ver-index', versionNumber: 1,
            // Legacy format: no hashes field
            snapshot: { siteId: 'site-1', branchId: 'branch-1', componentNames: ['HeroBlock'], provenance: { HeroBlock: 'site' }, updatedAt: '' },
          });
        }
        // Component doc returns its descriptor with current hash
        return Promise.resolve({
          id: 'ver-hero', versionNumber: 1,
          snapshot: { ...descriptor, descriptorHash: currentHash },
        });
      },
    );

    const capturedIndexSnapshots: unknown[] = [];
    mockClient.versions.create.mockImplementation(
      (_siteId: string, params: { documentId: string; branchId: string; snapshot: unknown }) => {
        if (params.documentId === 'doc-index') {
          capturedIndexSnapshots.push(params.snapshot);
        }
        return Promise.resolve({ id: 'ver-new', versionNumber: 2, snapshot: params.snapshot });
      },
    );

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));

    // All components matched — nothing registered
    expect(result.current.result?.registered).toBe(0);
    expect(result.current.result?.skipped).toBe(1);

    // Index MUST be rewritten to add the hashes field
    expect(capturedIndexSnapshots.length).toBe(1);
    const writtenIndex = capturedIndexSnapshots[0] as Record<string, unknown>;
    expect(writtenIndex.hashes).toBeDefined();
    const hashes = writtenIndex.hashes as Record<string, string>;
    expect(hashes.HeroBlock).toBe(currentHash);
  });

  // branchId guard: skip registration when branchId is not yet resolved
  it('does not call any API when branchId is null (production initial state)', async () => {
    const ctx = makeMockContext({ branchId: null as unknown as string });
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result.current.status).toBe('idle');
    expect(mockClient.documents.list).not.toHaveBeenCalled();
    expect(mockClient.versions.getLatest).not.toHaveBeenCalled();
    expect(mockClient.documents.create).not.toHaveBeenCalled();
    expect(mockClient.versions.create).not.toHaveBeenCalled();
  });

  it('does not call any API when branchId is empty string', async () => {
    const ctx = makeMockContext({ branchId: '' });
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    // Allow any pending microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Status should remain 'idle' — registration was skipped entirely
    expect(result.current.status).toBe('idle');

    // No API calls should have been made
    expect(mockClient.documents.list).not.toHaveBeenCalled();
    expect(mockClient.versions.getLatest).not.toHaveBeenCalled();
    expect(mockClient.documents.create).not.toHaveBeenCalled();
    expect(mockClient.versions.create).not.toHaveBeenCalled();
  });

  it('runs registration once branchId resolves from empty to a real value', async () => {
    const ctx = makeMockContext({ branchId: '' });
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    mockClient.documents.list.mockResolvedValue([]);
    mockClient.documents.create.mockResolvedValue({ id: 'doc-new', path: '_registry/components/HeroBlock' });

    let ctxValue = { ...ctx, branchId: '' };
    const DynamicWrapper = ({ children }: { children: React.ReactNode }) => (
      <CSSPuckContext.Provider value={ctxValue}>{children}</CSSPuckContext.Provider>
    );

    const { result, rerender } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: DynamicWrapper },
    );

    // While branchId is empty, status stays idle and no API calls happen
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.status).toBe('idle');
    expect(mockClient.documents.list).not.toHaveBeenCalled();

    // branchId resolves — trigger re-render with real branch
    ctxValue = { ...ctx, branchId: 'branch-main' };
    rerender();

    // Now registration should run
    await waitFor(() => expect(result.current.status).toBe('registered'));
    expect(mockClient.documents.list).toHaveBeenCalledWith('site-1', 'branch-main', expect.anything());
  });

  // Test 5: Branch switch re-registers components against new branch
  it('re-runs registration when branchId changes (branch switch)', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    mockClient.documents.list.mockResolvedValue([]);
    mockClient.documents.create.mockResolvedValue({ id: 'doc-new', path: '/_registry/components/HeroBlock' });

    // Create a wrapper with a mutable context so we can update branchId
    let ctxValue = { ...ctx, branchId: 'branch-main' };
    const DynamicWrapper = ({ children }: { children: React.ReactNode }) => (
      <CSSPuckContext.Provider value={ctxValue}>{children}</CSSPuckContext.Provider>
    );

    const { result, rerender } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: DynamicWrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));
    const firstCallCount = (mockClient.documents.list.mock.calls as unknown[][]).length;
    expect(firstCallCount).toBeGreaterThanOrEqual(1);

    // Switch branch: update context and trigger re-render
    ctxValue = { ...ctx, branchId: 'branch-staging' };
    rerender();

    await waitFor(() => {
      const calls = mockClient.documents.list.mock.calls as unknown[][];
      return calls.length > firstCallCount;
    });

    // documents.list called a second time (for the new branch)
    const allCalls = mockClient.documents.list.mock.calls as unknown[][];
    expect(allCalls.length).toBeGreaterThan(firstCallCount);
    // The second call should include branch-staging
    const secondCallArgs = allCalls[allCalls.length - 1] as [string, string, { pathPrefix: string }];
    expect(secondCallArgs[1]).toBe('branch-staging');
  });
});
