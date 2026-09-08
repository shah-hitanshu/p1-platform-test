/**
 * Purge request-body validation, extracted from the handler so its mainline stays
 * readable. Collects EVERY problem before answering, so a caller fixes their request
 * in one round trip instead of discovering errors one 400 at a time.
 *
 * Attribution is caller-supplied and validated for shape only: the operator token
 * carries no principal, so the audit row's integrity rests on token custody, not on
 * this body. Strict about unknown keys — a destructive endpoint should reject a
 * typo'd field rather than silently ignore it.
 */

import type { PrincipalType } from '../types';

export interface PurgeRequestBody {
  requestedBy: string;
  requestedByType: PrincipalType;
  reason: string;
}

export type ParsedPurgeRequest =
  | { ok: true; value: PurgeRequestBody }
  | { ok: false; errors: string[] };

const PRINCIPAL_TYPES = new Set<string>(['user', 'agent', 'system']);
const BODY_KEYS = new Set(['requestedBy', 'requestedByType', 'reason']);

export async function readPurgeRequest(request: Request): Promise<ParsedPurgeRequest> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, errors: ['body must be a JSON object'] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['body must be a JSON object'] };
  }
  const body = raw as Record<string, unknown>;

  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) errors.push(`unknown field: ${key}`);
  }

  const requestedBy = typeof body.requestedBy === 'string' ? body.requestedBy.trim() : '';
  if (requestedBy.length < 1 || requestedBy.length > 200) {
    errors.push('requestedBy is required (1-200 chars)');
  }

  const requestedByType = body.requestedByType ?? 'user';
  if (typeof requestedByType !== 'string' || !PRINCIPAL_TYPES.has(requestedByType)) {
    errors.push("requestedByType must be 'user', 'agent', or 'system'");
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 1 || reason.length > 1000) {
    errors.push('reason is required (1-1000 chars)');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { requestedBy, requestedByType: requestedByType as PrincipalType, reason },
  };
}
