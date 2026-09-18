import type { ThreadContextType } from '@pantheon-systems/css-client';

/**
 * What a thread can be attached to.
 *
 * A thread is not a property of a block: the same thread machinery hangs off
 * pages, sites and workstreams, so what a trigger is talking about travels as a
 * (kind, id) pair rather than being inferred from where the trigger is rendered.
 */
export type { ThreadContextType } from '@pantheon-systems/css-client';

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
  /** Whether the thread has been resolved. Never true when there is no thread. */
  resolved?: boolean;
}

/**
 * How the thing being discussed is shown to a reader.
 *
 * A (kind, id) pair is enough to find the thing, but not enough to name it: the block id
 * is opaque, and its name lives in the editor's config. Each kind of context has its own
 * place to look that up, so whichever trigger knows where resolves it and hands the
 * answer along, and the thread view only has to display it.
 */
export interface ThreadSubject {
  /** What to call the thing being discussed — a block's name, a page's title. */
  label: string;
  /** A PDS icon name that reads as the kind of thing it is. */
  icon?: string;
}
