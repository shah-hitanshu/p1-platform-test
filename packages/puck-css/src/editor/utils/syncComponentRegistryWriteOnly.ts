/**
 * syncComponentRegistryWriteOnly
 *
 * A write-only variant of syncComponentRegistry for callers holding a
 * write:registry-scoped token, which has no read access at all by design
 * (see collaborative-state-system's §0 write:registry scope). Skips the
 * existence/hash-check reads entirely and posts every descriptor on every
 * run, relying on the backend's upsert-on-conflict behavior for _registry/*
 * paths. The backend compares the posted content against what the branch
 * already stores and writes a version only when it differs, so posting
 * unconditionally costs nothing but the request — the skip-if-unchanged
 * decision moved to the one side that can read, keeping this token unable
 * to read anything.
 *
 * The interactive editor keeps using syncComponentRegistry, unmodified,
 * with its skip-if-unchanged behavior — this variant is CI-only.
 */

import type { P1Client } from '@pantheon-systems/css-client';
import { buildRegistryIndex, type ComponentDescriptor, type RegistryIndex } from './componentRegistry.js';
import { componentPath, INDEX_PATH } from './syncComponentRegistry.js';

export interface WriteOnlyRegistrationResult {
  total: number;
}

export async function syncComponentRegistryWriteOnly(
  client: P1Client,
  siteId: string,
  branchId: string,
  descriptors: ComponentDescriptor[],
): Promise<WriteOnlyRegistrationResult> {
  await Promise.all(
    descriptors.map((descriptor) =>
      client.documents.create({
        siteId,
        branchId,
        path: componentPath(descriptor.name),
        snapshot: descriptor as unknown as Record<string, unknown>,
      }),
    ),
  );

  // Every descriptor above was just unconditionally rewritten with its true
  // current content — that IS a full per-component verification, the
  // strongest one possible (PCC-3430). Stamping verifiedAt here means the
  // next editor load can trust the fast path immediately instead of forcing
  // an unnecessary per-component fetch right after this run.
  const index: RegistryIndex = buildRegistryIndex(descriptors, siteId, branchId, new Date().toISOString());
  await client.documents.create({
    siteId,
    branchId,
    path: INDEX_PATH,
    snapshot: index as unknown as Record<string, unknown>,
  });

  return { total: descriptors.length };
}
