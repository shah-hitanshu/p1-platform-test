/**
 * What a thread can be attached to.
 *
 * A thread is not a property of a block: the same thread machinery hangs off
 * pages, sites and workstreams, so what a trigger is talking about travels as a
 * (kind, id) pair rather than being inferred from where the trigger is rendered.
 */
export type ThreadContextType = 'block' | 'page' | 'site' | 'workstream';

export interface ThreadContext {
  contextType: ThreadContextType;
  /** The id of the thing being discussed — the block id, the page path, and so on. */
  contextId: string;
  /**
   * The thread already open on this context, when there is one. Absent means no
   * thread has been started yet, and starting one is the trigger's job.
   */
  threadId?: string;
  /** How many comments the thread holds. Zero when there is no thread. */
  commentCount?: number;
}
