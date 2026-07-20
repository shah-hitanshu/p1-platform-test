// @vitest-environment node
/**
 * syncComponentRegistryWriteOnly Tests
 *
 * The CI-only counterpart to syncComponentRegistry, for a write:registry-scoped
 * token with no read access at all. Must never call documents.list or
 * versions.getLatest — this suite's mock client fails loudly if either is
 * invoked, rather than silently returning empty data, so a regression back
 * toward the read-based algorithm shows up as a clear assertion failure.
 */

import { describe, it, expect, vi } from 'vitest';
import { syncComponentRegistryWriteOnly } from '../editor/utils/syncComponentRegistryWriteOnly.js';
import { extractDescriptors } from '../editor/utils/componentRegistry.js';

function makeMockClient() {
  return {
    documents: {
      list: vi.fn().mockRejectedValue(new Error('write-only sync must not call documents.list')),
      create: vi.fn().mockResolvedValue({ id: 'doc-new', path: '_registry/components/HeroBlock' }),
    },
    versions: {
      getLatest: vi.fn().mockRejectedValue(new Error('write-only sync must not call versions.getLatest')),
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

describe('syncComponentRegistryWriteOnly', () => {
  it('creates every descriptor as a document, passing the full snapshot in the same call', async () => {
    const client = makeMockClient();
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path }),
    );

    const descriptors = extractDescriptors(simplePuckConfig);
    await syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors);

    expect(client.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-1',
        branchId: 'branch-1',
        path: '_registry/components/HeroBlock',
        snapshot: expect.objectContaining({ name: 'HeroBlock' }),
      }),
    );
  });

  it('writes the index using buildRegistryIndex over the full descriptor set', async () => {
    const client = makeMockClient();
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path }),
    );

    const descriptors = extractDescriptors(twoComponentConfig);
    await syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors);

    const createCalls = client.documents.create.mock.calls as { path: string; snapshot: unknown }[][];
    const indexCall = createCalls.find((args) => args[0].path === '_registry/index');
    expect(indexCall).toBeDefined();

    const indexSnapshot = (indexCall as { path: string; snapshot: unknown }[])[0].snapshot as Record<string, unknown>;
    expect(indexSnapshot.componentNames).toEqual(expect.arrayContaining(['HeroBlock', 'CardBlock']));
  });

  // PCC-3430 follow-up (caught in review of the #113/#116 merge reconciliation):
  // this function unconditionally rewrites every descriptor with its true
  // current content on every run — that IS a full per-component verification,
  // the strongest one possible. Without stamping verifiedAt, the self-heal
  // logic in syncComponentRegistry/useComponentRegistry would treat the index
  // as stale immediately after every CI run and force an unnecessary
  // per-component fetch on the very next editor load.
  it('stamps verifiedAt on the written index, since a full unconditional rewrite is itself a complete verification', async () => {
    const client = makeMockClient();
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path }),
    );

    const descriptors = extractDescriptors(twoComponentConfig);
    const before = Date.now();
    await syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors);
    const after = Date.now();

    const createCalls = client.documents.create.mock.calls as { path: string; snapshot: unknown }[][];
    const indexCall = createCalls.find((args) => args[0].path === '_registry/index');
    const indexSnapshot = (indexCall as { path: string; snapshot: unknown }[])[0].snapshot as Record<string, unknown>;

    expect(typeof indexSnapshot.verifiedAt).toBe('string');
    const verifiedAtMs = Date.parse(indexSnapshot.verifiedAt as string);
    expect(verifiedAtMs).toBeGreaterThanOrEqual(before);
    expect(verifiedAtMs).toBeLessThanOrEqual(after);
  });

  it('never calls documents.list or versions.getLatest', async () => {
    const client = makeMockClient();
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path }),
    );

    const descriptors = extractDescriptors(simplePuckConfig);
    await syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors);

    expect(client.documents.list).not.toHaveBeenCalled();
    expect(client.versions.getLatest).not.toHaveBeenCalled();
    expect(client.versions.create).not.toHaveBeenCalled();
  });

  it('creates every descriptor unconditionally, even if a caller has previously synced (no skip logic)', async () => {
    const client = makeMockClient();
    let callCount = 0;
    client.documents.create.mockImplementation(({ path }: { path: string }) => {
      callCount++;
      return Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path });
    });

    const descriptors = extractDescriptors(twoComponentConfig);
    await syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors);
    await syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors);

    // 2 components + 1 index, twice, with no hash-based skipping.
    expect(callCount).toBe(6);
  });

  it('returns { total } equal to the descriptor count', async () => {
    const client = makeMockClient();
    client.documents.create.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path }),
    );

    const descriptors = extractDescriptors(twoComponentConfig);
    const result = await syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors);

    expect(result.total).toBe(2);
  });

  it('rejects when a documents.create call fails', async () => {
    const client = makeMockClient();
    client.documents.create.mockRejectedValue(new Error('Network error'));

    const descriptors = extractDescriptors(simplePuckConfig);
    await expect(
      syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors),
    ).rejects.toThrow('Network error');
  });

  it('sends a full ComponentDescriptor snapshot with all fields, not just name/path', async () => {
    const client = makeMockClient();
    const capturedSnapshots: Record<string, unknown>[] = [];
    client.documents.create.mockImplementation(
      ({ path, snapshot }: { path: string; snapshot: Record<string, unknown> }) => {
        capturedSnapshots.push(snapshot);
        return Promise.resolve({ id: `doc-${path.replace(/\//g, '-')}`, path });
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
    await syncComponentRegistryWriteOnly(client as never, 'site-1', 'branch-1', descriptors);

    const componentSnapshot = capturedSnapshots.find((s) => s.name === 'FeatureCard');
    expect(componentSnapshot).toBeDefined();
    const snapshot = componentSnapshot as Record<string, unknown>;

    expect(snapshot.defaultProps).toEqual({ variant: 'primary' });
    const ai = snapshot.ai as Record<string, unknown>;
    expect(ai.instructions).toBe('Use for feature highlights on landing pages.');
    expect(typeof snapshot.descriptorHash).toBe('string');
    expect((snapshot.descriptorHash as string).length).toBeGreaterThan(0);
  });
});
