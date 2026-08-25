import type { CompletionResult, FnToolCall } from '../providers/transport.js';

/**
 * What the agentic loop does next.
 *
 * Kept out of the Durable Object because constructing a `ChatAgent` needs a live one — see
 * chat-agent.test.ts, which reaches its methods off the prototype for exactly that reason. As
 * a function of the completion alone, each branch the loop can take is a table test instead of
 * a streaming transport, a DO env and a websocket per case.
 */
export type TurnStep =
  | { kind: 'run_tools'; toolCalls: FnToolCall[] }
  | { kind: 'continue_truncated'; toolCallsDropped: number }
  | { kind: 'complete' };

/**
 * Steps one turn may take. Nothing else bounds it: the panel's silence watchdog is reset by
 * every tool frame, so a model that keeps calling tools bills indefinitely. A page build runs 8-12.
 */
export const MAX_TURN_STEPS = 25;

export const STEP_LIMIT_MESSAGE =
  'This request needed too many steps, so I stopped. Anything I already changed is saved — '
  + 'try narrowing it to one page or one change.';

/** Sent to the model only: a mechanism, not something the user said. */
export const TRUNCATED_NUDGE =
  'Your last reply was cut off at the output limit. Continue in smaller steps: apply fewer '
  + 'operations per call, and build a long page in several passes.';

/** Whether the turn has spent its step budget. `step` is zero-based, so `maxSteps` calls run. */
export function atStepLimit(step: number, maxSteps: number = MAX_TURN_STEPS): boolean {
  return step >= maxSteps;
}

/**
 * A cut reply's tool calls are dropped rather than executed: a half-written
 * `apply_document_edits` is the one that would land on the page.
 */
export function afterCompletion(completion: CompletionResult): TurnStep {
  if (completion.stopReason === 'length') {
    return { kind: 'continue_truncated', toolCallsDropped: completion.toolCalls.length };
  }
  if (completion.toolCalls.length === 0) return { kind: 'complete' };
  return { kind: 'run_tools', toolCalls: completion.toolCalls };
}

/** The edit session the loop must close if the turn stops before the agent does. */
export interface TrackedEditSession {
  siteId: string;
  branchId: string;
  documentPath: string;
  editSessionId: string;
}

/**
 * Read rather than asserted, on both sides: cleanup hands all four values straight back to the
 * backend, and an `undefined` among them aborts nothing while the session stays open.
 */
export function trackedEditSession(
  input: Record<string, unknown>,
  result: unknown,
): TrackedEditSession | null {
  if (result === null || typeof result !== 'object') return null;
  const { editSessionId } = result as { editSessionId?: unknown };
  const { site_id: siteId, branch_id: branchId, document_path: documentPath } = input;
  if (
    typeof editSessionId !== 'string' || editSessionId === ''
    || typeof siteId !== 'string' || typeof branchId !== 'string'
    || typeof documentPath !== 'string'
  ) {
    return null;
  }
  return { siteId, branchId, documentPath, editSessionId };
}
