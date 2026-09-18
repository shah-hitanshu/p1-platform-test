/**
 * What a thread is anchored to. Block and page threads belong to a document;
 * site and workstream threads do not.
 */
export type ThreadContextType = 'block' | 'page' | 'site' | 'workstream';

export interface ThreadContextRef {
  type: ThreadContextType;
  id: string;
}
