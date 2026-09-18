import { useCallback, useState } from 'react';
import isEqual from 'lodash.isequal';
import type { ChangeSummary, ChangeSummaryEntry } from '@pantheon-systems/css-client';
import type { PropValue } from './prop-value.js';

export function entryKey(entry: ChangeSummaryEntry): string {
  return JSON.stringify([
    entry.classification,
    entry.componentId,
    entry.propPath ?? null,
    entry.structuralKind ?? null,
  ]);
}

/** A local dismissal covers one source comparison, so later changes remain visible. */
export function dismissalKey(summary: ChangeSummary, entry: ChangeSummaryEntry): string {
  return JSON.stringify([summary.upstreamDocumentId, summary.toVersionId, entryKey(entry)]);
}

export interface Replacement {
  /** Recovery can address an enclosing array or a parent created by the write. */
  pointer: string;
  sourceDocumentId: string;
  sourceVersionId: string;
  sourceValue: unknown;
  before: PropValue;
  inserted: PropValue;
}

export type ReplacementState = 'original' | 'replaced' | 'edited';

export function replacementState(
  replacement: Replacement | undefined,
  current: PropValue,
): ReplacementState {
  if (!replacement || isEqual(current, replacement.before)) {
    return 'original';
  }

  return isEqual(current, replacement.inserted) ? 'replaced' : 'edited';
}

/** Owned by the document control, whose lifetime spans drawer opens and closes. */
export function useReviewSession() {
  const [replacements, setReplacements] = useState<ReadonlyMap<string, Replacement>>(new Map());

  // Records survive rollback: editor undo can bring the inserted value back.
  const remember = useCallback((key: string, replacement: Replacement) => {
    setReplacements((previous) => new Map(previous).set(key, replacement));
  }, []);

  return { replacements, remember };
}

export type ReviewSession = ReturnType<typeof useReviewSession>;
