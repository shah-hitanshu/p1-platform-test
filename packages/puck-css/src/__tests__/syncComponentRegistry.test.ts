// @vitest-environment node
/**
 * syncComponentRegistry Tests
 *
 * Ports the algorithm-level cases from useComponentRegistry.test.tsx to call
 * the pure, React-free sync function directly. Proves the extraction needs
 * no DOM. Hook-specific behavior (branchId guards, branch-switch re-render,
 * onRegistered/onError plumbing) stays covered by useComponentRegistry.test.tsx,
 * unmodified — that file passing as-is is the regression proof this extraction
 * didn't change the browser flow.
 */

import { describe, it, expect, vi } from 'vitest';
import { syncComponentRegistry } from '../editor/utils/syncComponentRegistry.js';
import { extractDescriptors } from '../editor/utils/componentRegistry.js';

function makeMockClient() {
  return {
    documents: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'doc-new', path: '_registry/components/HeroBlock' }),
    },
    versions: {
      getLatest: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'ver-1', versionNumber: 1, snapshot: {} }),
    },
  };
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

describe('syncComponentRegistry', () => {
  it('creates a new document and version when no existing registry doc for a component', async () => {
    const client = makeMockClient();
    client.documents.list.mockResolvedValue([]);
    client.documents.create.mockResolvedValue({ id: 'doc-hero', path: '_registry/components/HeroBlock' });

    const descriptors = extractDescriptors(simplePuckConfig);
    await syncComponentRegistry(client as never, 'site-1', 'branch-1', descriptors);

    expect(client.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: '_registry/components/HeroBlock' }),
    );
    expect(client.versions.create).toHaveBeenCalled();
  });

  it('skips write when stored hash matches computed hash', async () => {
    const client = makeMockClient();
    const [descriptor] = extractDescriptors(simplePuckConfig);
    const storedHash = descriptor.descriptorHash;

    client.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    client.versions.getLatest.mockImplementation((_siteId: string, _branchId: string, docId: string) => {
      if (docId === 'doc-index') {
        return Promise.resolve({
          id: 'ver-index', versionNumber: 1,
          snapshot: {
            siteId: 'site-1', branchId: 'branch-1',
            componentNames: ['HeroBlock'],
            provenance: { HeroBlock: 'site' },
            updatedAt: '',
            verifiedAt: new Date().toISOString(),
            hashes: { HeroBlock: storedHash },
          },
        });
      }
      return Promise.resolve({ id: 'ver-1', versionNumber: 1, snapshot: { ...descriptor, descriptorHash: storedHash } });
    });

    const result = await syncComponentRegistry(client as never, 'site-1', 'branch-1', [descriptor]);

    expect(client.versions.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.registered).toBe(0);
  });

  it('writes a new version when stored hash differs', async () => {
    const client = makeMockClient();
    client.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    client.versions.getLatest.mockResolvedValue({
      id: 'ver-old', versionNumber: 1,
      snapshot: { name: 'HeroBlock', descriptorHash: 'stale-hash-000' },
    });

    const descriptors = extractDescriptors(simplePuckConfig);
    await syncComponentRegistry(client as never, 'site-1', 'branch-1', descriptors);

    const calls = client.versions.create.mock.calls as unknown[][];
    const heroCall = calls.find((args) => (args[1] as Record<string, string>).documentId === 'doc-hero');
    expect(heroCall).toBeDefined();
  });

  it('rejects when the initial documents.list call fails', async () => {
    const client = makeMockClient();
    client.documents.list.mockRejectedValue(new Error('Network error'));

    const descriptors = extractDescriptors(simplePuckConfig);
    await expect(
      syncComponentRegistry(client as never, 'site-1', 'branch-1', descriptors),
    ).rejects.toThrow('Network error');
  });

  it('registers all components and index when registry is empty (total === 2, registered === 2)', async () => {
    const client = makeMockClient();
    client.documents.list.mockResolvedValue([]);
    let docCounter = 0;
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${++docCounter}`, path }),
    );
    client.versions.create.mockResolvedValue({ id: 'ver-1', versionNumber: 1, snapshot: {} });

    const descriptors = extractDescriptors(twoComponentConfig);
    const result = await syncComponentRegistry(client as never, 'site-1', 'branch-1', descriptors);

    expect(result.total).toBe(2);
    expect(result.registered).toBe(2);
    expect(result.skipped).toBe(0);

    const createCalls = client.documents.create.mock.calls as { path: string }[][];
    const createdPaths = createCalls.map((args) => args[0].path);
    expect(createdPaths).toContain('_registry/components/HeroBlock');
    expect(createdPaths).toContain('_registry/components/CardBlock');
    expect(createdPaths).toContain('_registry/index');
    expect(client.versions.create.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('writes new version on existing doc when hash differs — does not call documents.create for component', async () => {
    const client = makeMockClient();
    client.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    client.versions.getLatest.mockResolvedValue({
      id: 'ver-old', versionNumber: 1,
      snapshot: { name: 'HeroBlock', descriptorHash: 'stale-hash-000' },
    });
    client.documents.create.mockResolvedValue({ id: 'doc-index', path: '_registry/index' });

    const descriptors = extractDescriptors(simplePuckConfig);
    await syncComponentRegistry(client as never, 'site-1', 'branch-1', descriptors);

    const createCalls = client.documents.create.mock.calls as { path: string }[][];
    const componentCreateCalls = createCalls.filter((args) => args[0].path.startsWith('_registry/components/'));
    expect(componentCreateCalls).toHaveLength(0);

    const indexCreateCalls = createCalls.filter((args) => args[0].path === '_registry/index');
    expect(indexCreateCalls).toHaveLength(1);

    const versionCalls = client.versions.create.mock.calls as unknown[][];
    const heroVersionCall = versionCalls.find((args) => (args[1] as Record<string, string>).documentId === 'doc-hero');
    expect(heroVersionCall).toBeDefined();
  });

  it('writes a valid ComponentDescriptor snapshot with all required fields', async () => {
    const client = makeMockClient();
    client.documents.list.mockResolvedValue([]);
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path }),
    );

    const versionCreateCalls: { documentId: string; snapshot: unknown }[] = [];
    client.versions.create.mockImplementation(
      (_siteId: string, params: { documentId: string; branchId: string; snapshot: unknown }) => {
        versionCreateCalls.push({ documentId: params.documentId, snapshot: params.snapshot });
        return Promise.resolve({ id: 'ver-1', versionNumber: 1, snapshot: params.snapshot });
      },
    );

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

    const descriptors = extractDescriptors(configWithAllFields);
    await syncComponentRegistry(client as never, 'site-1', 'branch-1', descriptors);

    const componentCall = versionCreateCalls.find(
      (c) => (c.snapshot as Record<string, unknown>)?.name === 'FeatureCard',
    );
    expect(componentCall).toBeDefined();

    const snapshot = (componentCall as { documentId: string; snapshot: unknown }).snapshot as Record<string, unknown>;
    expect(snapshot.name).toBe('FeatureCard');

    const fields = snapshot.fields as Record<string, unknown>[];
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('select');
    expect(fields[0].name).toBe('variant');
    expect(fields[0].label).toBe('Variant');
    const options = fields[0].options as { label: string; value: string }[];
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ label: 'Primary', value: 'primary' });
    expect(options[1]).toEqual({ label: 'Secondary', value: 'secondary' });

    expect(snapshot.defaultProps).toEqual({ variant: 'primary' });

    const ai = snapshot.ai as Record<string, unknown>;
    expect(ai.instructions).toBe('Use for feature highlights on landing pages.');

    expect(typeof snapshot.descriptorHash).toBe('string');
    expect((snapshot.descriptorHash as string).length).toBeGreaterThan(0);
    expect(/^[0-9a-f]+$/.test(snapshot.descriptorHash as string)).toBe(true);

    expect(snapshot.provenance).toBe('site');

    expect(typeof snapshot.registeredAt).toBe('string');
    expect(/^\d{4}-\d{2}-\d{2}T/.test(snapshot.registeredAt as string)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fast-path tests: hashes stored in registry index
  // -------------------------------------------------------------------------

  it('fast path: reads hashes from index, makes no per-component getLatest calls', async () => {
    const client = makeMockClient();
    const [descriptor] = extractDescriptors(simplePuckConfig);
    const currentHash = descriptor.descriptorHash;

    client.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    client.versions.getLatest.mockImplementation((_siteId: string, _branchId: string, docId: string) => {
      if (docId === 'doc-index') {
        return Promise.resolve({
          id: 'ver-index', versionNumber: 1,
          snapshot: {
            siteId: 'site-1', branchId: 'branch-1',
            componentNames: ['HeroBlock'],
            provenance: { HeroBlock: 'site' },
            updatedAt: new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
            hashes: { HeroBlock: currentHash },
          },
        });
      }
      return Promise.resolve({ id: 'ver-hero', versionNumber: 1, snapshot: {} });
    });

    const result = await syncComponentRegistry(client as never, 'site-1', 'branch-1', [descriptor]);

    expect(client.versions.getLatest).toHaveBeenCalledTimes(1);
    expect(client.versions.getLatest).toHaveBeenCalledWith('site-1', 'branch-1', 'doc-index');
    expect(client.versions.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.registered).toBe(0);
  });

  it('fast path: writes only the changed component when its hash differs in the index', async () => {
    const client = makeMockClient();
    const descriptors = extractDescriptors(twoComponentConfig);
    const heroDesc = descriptors.find((d) => d.name === 'HeroBlock');
    const cardDesc = descriptors.find((d) => d.name === 'CardBlock');
    expect(heroDesc).toBeDefined();
    expect(cardDesc).toBeDefined();
    const hero = heroDesc as (typeof descriptors)[number];
    const card = cardDesc as (typeof descriptors)[number];

    client.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-card', path: '_registry/components/CardBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    client.versions.getLatest.mockImplementation((_siteId: string, _branchId: string, docId: string) => {
      if (docId === 'doc-index') {
        return Promise.resolve({
          id: 'ver-index', versionNumber: 1,
          snapshot: {
            siteId: 'site-1', branchId: 'branch-1',
            componentNames: ['HeroBlock', 'CardBlock'],
            provenance: { HeroBlock: 'site', CardBlock: 'site' },
            updatedAt: new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
            hashes: { HeroBlock: 'stale-hash-000', CardBlock: card.descriptorHash },
          },
        });
      }
      return Promise.resolve({ id: 'ver', versionNumber: 1, snapshot: {} });
    });
    client.versions.create.mockResolvedValue({ id: 'ver-new', versionNumber: 2, snapshot: {} });

    const result = await syncComponentRegistry(client as never, 'site-1', 'branch-1', descriptors);

    expect(client.versions.getLatest).toHaveBeenCalledTimes(1);
    expect(client.versions.getLatest).toHaveBeenCalledWith('site-1', 'branch-1', 'doc-index');
    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(1);

    const createCalls = client.versions.create.mock.calls as unknown[][];
    const docIds = createCalls.map((args) => (args[1] as Record<string, string>).documentId);
    expect(docIds).toContain('doc-hero');
    expect(docIds).not.toContain('doc-card');
    expect(docIds).toContain('doc-index');

    const indexWriteCall = createCalls.find((args) => (args[1] as Record<string, string>).documentId === 'doc-index');
    const indexSnapshot = ((indexWriteCall as unknown[])[1] as Record<string, unknown>).snapshot as Record<string, unknown>;
    const writtenHashes = indexSnapshot.hashes as Record<string, string>;
    expect(writtenHashes.HeroBlock).toBe(hero.descriptorHash);
    expect(writtenHashes.CardBlock).toBe(card.descriptorHash);
  });

  it('fast path: written index includes hashes field enabling future fast-path runs', async () => {
    const client = makeMockClient();
    client.documents.list.mockResolvedValue([]);
    let docCounter = 0;
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${++docCounter}`, path }),
    );

    const capturedSnapshots: { documentId: string; snapshot: unknown }[] = [];
    client.versions.create.mockImplementation(
      (_siteId: string, params: { documentId: string; branchId: string; snapshot: unknown }) => {
        capturedSnapshots.push({ documentId: params.documentId, snapshot: params.snapshot });
        return Promise.resolve({ id: 'ver-1', versionNumber: 1, snapshot: params.snapshot });
      },
    );

    const [descriptor] = extractDescriptors(simplePuckConfig);
    await syncComponentRegistry(client as never, 'site-1', 'branch-1', [descriptor]);

    const indexWrite = capturedSnapshots.find(
      (c) => (c.snapshot as Record<string, unknown>)?.componentNames !== undefined,
    );
    expect(indexWrite).toBeDefined();
    const indexSnapshot = (indexWrite as { documentId: string; snapshot: unknown }).snapshot as Record<string, unknown>;
    expect(indexSnapshot.hashes).toBeDefined();
    const hashes = indexSnapshot.hashes as Record<string, string>;
    expect(hashes.HeroBlock).toBe(descriptor.descriptorHash);
  });

  // Regression: index hashes can drift out of sync with on-disk component docs
  // (partial historical writes, out-of-band deletes, CoW interactions where the
  // index was inherited but referenced component docs were not). The fast path
  // must NOT skip a descriptor whose hash matches the index when the named
  // component document is missing.
  it('fast path: re-creates a component when index has its hash but the doc is missing (desynced index)', async () => {
    const client = makeMockClient();
    const descriptors = extractDescriptors(twoComponentConfig);
    const heroDesc = descriptors.find((d) => d.name === 'HeroBlock');
    const cardDesc = descriptors.find((d) => d.name === 'CardBlock');
    expect(heroDesc).toBeDefined();
    expect(cardDesc).toBeDefined();
    const hero = heroDesc as (typeof descriptors)[number];
    const card = cardDesc as (typeof descriptors)[number];

    // CardBlock document exists; HeroBlock document is MISSING from the listing.
    client.documents.list.mockResolvedValue([
      { id: 'doc-card', path: '_registry/components/CardBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    client.versions.getLatest.mockImplementation((_siteId: string, _branchId: string, docId: string) => {
      if (docId === 'doc-index') {
        return Promise.resolve({
          id: 'ver-index', versionNumber: 1,
          snapshot: {
            siteId: 'site-1', branchId: 'branch-1',
            componentNames: ['HeroBlock', 'CardBlock'],
            provenance: { HeroBlock: 'site', CardBlock: 'site' },
            updatedAt: new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
            hashes: { HeroBlock: hero.descriptorHash, CardBlock: card.descriptorHash },
          },
        });
      }
      return Promise.resolve({ id: 'ver', versionNumber: 1, snapshot: {} });
    });

    let docCounter = 0;
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-new-${++docCounter}`, path }),
    );
    client.versions.create.mockResolvedValue({ id: 'ver-new', versionNumber: 2, snapshot: {} });

    const result = await syncComponentRegistry(client as never, 'site-1', 'branch-1', descriptors);

    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(1);

    const createCalls = client.documents.create.mock.calls as { path: string }[][];
    const createdPaths = createCalls.map((args) => args[0].path);
    expect(createdPaths).toContain('_registry/components/HeroBlock');
    expect(createdPaths).not.toContain('_registry/components/CardBlock');

    const versionCalls = client.versions.create.mock.calls as unknown[][];
    const versionDocIds = versionCalls.map((args) => (args[1] as Record<string, string>).documentId);
    expect(versionDocIds).not.toContain('doc-card');
    expect(versionDocIds).toContain('doc-index');
  });

  it('fast path: promotes legacy index (no hashes field) to include hashes even when nothing changed', async () => {
    const client = makeMockClient();
    const [descriptor] = extractDescriptors(simplePuckConfig);
    const currentHash = descriptor.descriptorHash;

    client.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    client.versions.getLatest.mockImplementation((_siteId: string, _branchId: string, docId: string) => {
      if (docId === 'doc-index') {
        return Promise.resolve({
          id: 'ver-index', versionNumber: 1,
          snapshot: { siteId: 'site-1', branchId: 'branch-1', componentNames: ['HeroBlock'], provenance: { HeroBlock: 'site' }, updatedAt: '' },
        });
      }
      return Promise.resolve({ id: 'ver-hero', versionNumber: 1, snapshot: { ...descriptor, descriptorHash: currentHash } });
    });

    const capturedIndexSnapshots: unknown[] = [];
    client.versions.create.mockImplementation(
      (_siteId: string, params: { documentId: string; branchId: string; snapshot: unknown }) => {
        if (params.documentId === 'doc-index') {
          capturedIndexSnapshots.push(params.snapshot);
        }
        return Promise.resolve({ id: 'ver-new', versionNumber: 2, snapshot: params.snapshot });
      },
    );

    const result = await syncComponentRegistry(client as never, 'site-1', 'branch-1', [descriptor]);

    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(capturedIndexSnapshots.length).toBe(1);
    const writtenIndex = capturedIndexSnapshots[0] as Record<string, unknown>;
    expect(writtenIndex.hashes).toBeDefined();
    const hashes = writtenIndex.hashes as Record<string, string>;
    expect(hashes.HeroBlock).toBe(currentHash);
  });

  // Root-cause reproduction for PCC-3430 (p1-teamworks: HeroLeft/FeatureGrid/
  // FeatureGridIconLabel stuck at a stale descriptor after gaining new fields).
  //
  // The fast path's skip decision (line ~147: `existingDoc !== undefined &&
  // storedHash === descriptor.descriptorHash`) trusts the index's `hashes` map
  // and never reads the component document's own stored content — that's the
  // entire point of the N→1 optimization. The desync test above ("doc missing")
  // proves the fast path self-heals when the document doesn't exist at all.
  // This test covers the mirror-image case: the index's hash entry for a
  // component equals the CURRENT computed hash while that component's actual
  // document content is still the OLD schema (e.g. the document write
  // silently failed or reverted after the index was already written).
  //
  // UPDATE (PCC-3430, reconciled during the #113/#116 merge): this used to be
  // an undetectable blind spot. It no longer is — the periodic self-heal
  // verification landed in #116 treats a missing `verifiedAt` (every
  // pre-existing index, including this test's) as stale, forcing a real
  // per-component check that reads the document's own content directly and
  // discovers the mismatch. See useComponentRegistry.test.tsx for the two
  // companion tests (forces verification when stale; preserves the fast path
  // when verifiedAt is recent) — this test ports the "stale" case to the
  // pure-function level for parity with the rest of this file's coverage.
  it('self-heals a desync where the index hash already matches current but the document content is stale (verifiedAt missing/stale forces a real check)', async () => {
    const client = makeMockClient();
    const [descriptor] = extractDescriptors(simplePuckConfig); // current schema: just `title`

    // Index already reports the CURRENT descriptor's hash for HeroBlock — as if
    // a prior run recorded this hash without the component doc's own write ever
    // having landed (or having since reverted). The doc genuinely exists. No
    // verifiedAt is set, matching every real index that predates this fix.
    client.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    client.versions.getLatest.mockImplementation((_siteId: string, _branchId: string, docId: string) => {
      if (docId === 'doc-index') {
        return Promise.resolve({
          id: 'ver-index', versionNumber: 1,
          snapshot: {
            siteId: 'site-1', branchId: 'branch-1',
            componentNames: ['HeroBlock'],
            provenance: { HeroBlock: 'site' },
            updatedAt: '',
            hashes: { HeroBlock: descriptor.descriptorHash }, // <- already "current", desynced from the doc
          },
        });
      }
      // Now genuinely reached: missing verifiedAt forces the per-component
      // check, which reads this stale content directly.
      return Promise.resolve({ id: 'ver-1', versionNumber: 1, snapshot: { name: 'HeroBlock', descriptorHash: 'genuinely-old-hash' } });
    });

    const result = await syncComponentRegistry(client as never, 'site-1', 'branch-1', [descriptor]);

    expect(client.versions.getLatest).toHaveBeenCalledWith('site-1', 'branch-1', 'doc-hero');
    expect(client.versions.create).toHaveBeenCalled();
    expect(result.registered).toBe(1);
    expect(result.skipped).toBe(0);
  });

  // Confirms the ordinary (non-desynced) path works correctly in isolation —
  // i.e. the hash comparison itself is not broken for a simple, one-shot
  // "add a field to an already-registered component" change. Two sequential
  // calls (as two separate editor page loads would produce), not two mocked
  // states in one call.
  it('two sequential runs: correctly detects a genuine field addition to an already-registered component (not desynced)', async () => {
    const client = makeMockClient();
    const oldConfig = {
      components: {
        HeroLeft: {
          label: 'Hero Left',
          fields: { title: { type: 'text' }, subtitle: { type: 'text' } },
          defaultProps: { title: '', subtitle: '' },
        },
      },
    };
    const newConfig = {
      components: {
        HeroLeft: {
          label: 'Hero Left',
          fields: { title: { type: 'text' }, subtitle: { type: 'text' }, mediaSrc: { type: 'text' }, mediaAlt: { type: 'text' } },
          defaultProps: { title: '', subtitle: '', mediaSrc: '', mediaAlt: '' },
        },
      },
    };

    // In-memory fake backend: real state, not per-test mocked responses —
    // so the second run reads back whatever the first run actually wrote.
    const docsByPath = new Map<string, { id: string; path: string }>();
    const latestVersionByDocId = new Map<string, { id: string; versionNumber: number; snapshot: unknown }>();
    let docSeq = 0;
    let verSeq = 0;

    client.documents.list.mockImplementation(() =>
      Promise.resolve(Array.from(docsByPath.values())),
    );
    client.documents.create.mockImplementation(({ path }: { path: string }) => {
      if (docsByPath.has(path)) return Promise.reject(Object.assign(new Error('conflict'), { name: 'ConflictError' }));
      const doc = { id: `doc-${++docSeq}`, path };
      docsByPath.set(path, doc);
      return Promise.resolve(doc);
    });
    client.versions.getLatest.mockImplementation((_siteId: string, _branchId: string, docId: string) =>
      Promise.resolve(latestVersionByDocId.get(docId) ?? { id: 'none', versionNumber: 0, snapshot: {} }),
    );
    client.versions.create.mockImplementation(
      (_siteId: string, params: { documentId: string; snapshot: unknown }) => {
        const version = { id: `ver-${++verSeq}`, versionNumber: verSeq, snapshot: params.snapshot };
        latestVersionByDocId.set(params.documentId, version);
        return Promise.resolve(version);
      },
    );

    // Run 1: register the old (6-field-equivalent, here 2-field for brevity) schema.
    const oldDescriptors = extractDescriptors(oldConfig);
    const run1 = await syncComponentRegistry(client as never, 'site-1', 'branch-1', oldDescriptors);
    expect(run1.registered).toBe(1); // HeroLeft (index write is separate, not counted here)

    // Run 2: config now has two new fields. A separate call, as a separate
    // editor page load would produce — reading back whatever run 1 really wrote.
    const newDescriptors = extractDescriptors(newConfig);
    const run2 = await syncComponentRegistry(client as never, 'site-1', 'branch-1', newDescriptors);

    expect(run2.registered).toBe(1); // HeroLeft re-registered
    expect(run2.skipped).toBe(0);

    const heroDoc = docsByPath.get('_registry/components/HeroLeft');
    expect(heroDoc).toBeDefined();
    const heroLatest = latestVersionByDocId.get((heroDoc as { id: string }).id);
    const fields = (heroLatest?.snapshot as Record<string, unknown>).fields as { name: string }[];
    expect(fields.map((f) => f.name)).toEqual(['title', 'subtitle', 'mediaSrc', 'mediaAlt']);
  });
});
