import { describe, expect, it, vi } from 'vitest';
import type { ChangeSummary, P1Client } from '@pantheon-systems/css-client';
import { upstreamDiffQuery } from '../../features/localization/upstream-diff-query.js';

const summary: ChangeSummary = {
  relationType: 'template',
  derivedDocumentId: 'page',
  upstreamDocumentId: 'template',
  fromVersion: 2,
  toVersion: 3,
  fromVersionId: 'v2',
  toVersionId: 'v3',
  slotDelta: {},
  changes: [
    { classification: 'advisory', componentId: 'hero', propPath: '/badge' },
    { classification: 'autoApplied', componentId: 'hero', propPath: '/theme' },
  ],
  counts: { structural: 0, prop: 0, advisory: 1, autoApplied: 1, needsTranslation: 0 },
};

describe('upstream diff query', () => {
  it.each(['localization', 'template'] as const)(
    'excludes advisory changes from %s reviews',
    async (relationType) => {
      const getUpstreamDiff = vi.fn().mockResolvedValue({ ...summary, relationType });
      const client = { relations: { getUpstreamDiff } } as unknown as P1Client;

      const result = await upstreamDiffQuery(
        client, 'site', 'branch', 'page', relationType,
      ).queryFn();

      expect(result.changes).toEqual([summary.changes[1]]);
      expect(result.counts.advisory).toBe(0);
    },
  );
});
