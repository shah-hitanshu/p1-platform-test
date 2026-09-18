export const CONTEXT_TYPES = ['block', 'page', 'site', 'workstream'] as const;
export type ThreadContextType = (typeof CONTEXT_TYPES)[number];

/** What a thread is anchored to. Block ids survive merges, so a thread follows its block across branches. */
export interface ThreadContextRef {
  type: ThreadContextType;
  id: string;
}
