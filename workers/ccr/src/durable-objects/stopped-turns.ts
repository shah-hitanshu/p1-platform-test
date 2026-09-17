import { MAX_TURN_ID_LENGTH } from '../constants/security-limits';
import { jsonResponse } from './websocket-utils';

/**
 * Turns a user has stopped, and when. A stop is durable state rather than a
 * message: the agent may be mid-request, reconnecting, or restarted, and the
 * page has to be protected in all three cases.
 */
export type StoppedTurns = Map<string, number>;

/**
 * The one normalization every writer and reader of a turn id must share: a bar matches
 * only what this recorded, so the agent's CCR client repeats this exact
 * CR/LF-then-trim-then-slice transform before the id becomes a header. Let the two
 * diverge and a stop silently stops nothing.
 */
export function normalizeTurnId(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.replace(/[\r\n]/g, ' ').trim();
  return trimmed === '' ? undefined : trimmed.slice(0, MAX_TURN_ID_LENGTH);
}

/** Past this many stops the oldest is dropped; the key is supplied by the caller. */
const MAX_STOPPED_TURNS = 50;

/** Long enough that no turn still running could be carrying a swept id. */
const STOPPED_TURN_TTL_MS = 30 * 60 * 1000;

function sweep(turns: StoppedTurns, now: number): void {
  for (const [turnId, stoppedAt] of turns) {
    if (now - stoppedAt > STOPPED_TURN_TTL_MS) turns.delete(turnId);
  }
}

export function recordStoppedTurn(turns: StoppedTurns, turnId: string, now: number): void {
  sweep(turns, now);
  // Deleted first because Map.set on an existing key keeps the key's original
  // position, and the cap below evicts from the front on the assumption that
  // the front is the oldest stop.
  turns.delete(turnId);
  turns.set(turnId, now);
  while (turns.size > MAX_STOPPED_TURNS) {
    const oldest = turns.keys().next();
    if (oldest.done === true) break;
    turns.delete(oldest.value);
  }
}

export function isTurnStopped(
  turns: StoppedTurns,
  turnId: string | null,
  now: number,
): boolean {
  if (turnId === null || turnId === '') return false;
  const stoppedAt = turns.get(turnId);
  if (stoppedAt === undefined) return false;
  if (now - stoppedAt > STOPPED_TURN_TTL_MS) {
    turns.delete(turnId);
    return false;
  }
  return true;
}

/**
 * The refusal a barred turn gets, or null when it may proceed.
 *
 * 409 rather than 403: an expired-session 403 is the agent's cue to open another
 * session, which is exactly the retry a stop has to end. The code makes it
 * terminal rather than a hint to try again.
 */
export function stoppedTurnResponse(
  stoppedTurns: StoppedTurns,
  request: Request,
): Response | null {
  const turnId = normalizeTurnId(request.headers.get('X-Agent-Turn-Id'));
  if (!isTurnStopped(stoppedTurns, turnId ?? null, Date.now())) {
    return null;
  }
  return jsonResponse(409, {
    error: 'Turn stopped by a user',
    code: 'agent_turn_stopped',
  });
}

export function serializeStoppedTurns(turns: StoppedTurns): string {
  return JSON.stringify([...turns]);
}

export function deserializeStoppedTurns(raw: unknown): StoppedTurns {
  const turns: StoppedTurns = new Map();
  if (typeof raw !== 'string') return turns;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return turns;
  }
  if (!Array.isArray(parsed)) return turns;
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [turnId, stoppedAt] = entry as [unknown, unknown];
    if (typeof turnId === 'string' && typeof stoppedAt === 'number') {
      turns.set(turnId, stoppedAt);
    }
  }
  return turns;
}
