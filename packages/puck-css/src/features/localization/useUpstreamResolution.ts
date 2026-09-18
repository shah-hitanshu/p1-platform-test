/** Records field-level review decisions and keeps the shared diff cache consistent. */
import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ChangeSummary, ChangeSummaryEntry, P1Client } from '@pantheon-systems/css-client';
import { useP1SdkQueryClient } from '../../data/query-provider.js';
import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { upstreamDiffQueryKey, type UpstreamRelationType } from './upstream-diff-query.js';
import { entryKey } from './review-session.js';

function withChanges(summary: ChangeSummary, changes: ChangeSummaryEntry[]): ChangeSummary {
  const counts = { structural: 0, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 0 };

  for (const entry of changes) {
    counts[entry.classification]++;
  }

  return { ...summary, changes, counts };
}

interface ResolutionRequest {
  entry: ChangeSummaryEntry;
  summary: ChangeSummary;
  propPath: string;
}

interface RemovedEntry {
  entry: ChangeSummaryEntry;
  index: number;
  versionId: string;
}

export function useUpstreamResolution(
  client: P1Client,
  siteId: string,
  branchId: string,
  documentId: string,
  relationType: UpstreamRelationType,
) {
  const queryClient = useP1SdkQueryClient();
  const notifications = useP1PuckOptional()?.notifications;
  const pending = useRef(new Set<string>());
  const queryKey = upstreamDiffQueryKey(siteId, branchId, documentId, relationType);

  const mutation = useMutation({
    mutationFn: ({ entry, summary, propPath }: ResolutionRequest) =>
      client.relations.setUpstreamResolutions(
        siteId,
        branchId,
        documentId,
        [{ slotId: entry.componentId, propPath }],
        summary.toVersionId,
      ),

    onMutate: async ({ entry, summary }) => {
      // A read already on the wire must not put a pending resolution back in the list.
      await queryClient.cancelQueries({ queryKey });
      let removed: RemovedEntry | undefined;

      queryClient.setQueryData<ChangeSummary>(queryKey, (previous) => {
        if (!previous || previous.toVersionId !== summary.toVersionId) return previous;

        const index = previous.changes.findIndex((each) => entryKey(each) === entryKey(entry));
        const found = previous.changes[index];
        if (!found) return previous;

        removed = { entry: found, index, versionId: previous.toVersionId };

        // The toolbar, drawer, and locale badges share this summary.
        return withChanges(previous, previous.changes.filter((_, position) => position !== index));
      });

      return removed;
    },

    onError: (error: Error, _variables, removed) => {
      // Restore only this entry: a whole-summary rollback would resurrect resolved siblings.
      if (removed) {
        queryClient.setQueryData<ChangeSummary>(queryKey, (previous) => {
          if (!previous || previous.toVersionId !== removed.versionId) return previous;

          const alreadyListed = previous.changes.some((entry) => entryKey(entry) === entryKey(removed.entry));
          if (alreadyListed) return previous;

          const changes = [...previous.changes];
          changes.splice(removed.index, 0, removed.entry);

          return withChanges(previous, changes);
        });
      }

      notifications?.addError(`Could not record that change as reconciled: ${error.message}. It is still listed.`);
    },

    onSettled: (_data, _error, { entry }) => {
      pending.current.delete(entryKey(entry));

      // Sibling mutations share the same summary; refetch after the last write settles.
      if (pending.current.size === 0) void queryClient.invalidateQueries({ queryKey });
    },
  }, queryClient);

  return {
    isPending: (entry: ChangeSummaryEntry) => pending.current.has(entryKey(entry)),

    resolve: (entry: ChangeSummaryEntry, summary: ChangeSummary) => {
      const key = entryKey(entry);
      if (entry.propPath === undefined || pending.current.has(key)) return;

      // This guard is synchronous; a second click can precede the mutation's first render.
      pending.current.add(key);
      mutation.mutate({ entry, summary, propPath: entry.propPath });
    },
  };
}
