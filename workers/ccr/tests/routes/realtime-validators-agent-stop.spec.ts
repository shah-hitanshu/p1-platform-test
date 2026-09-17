/**
 * Tests for validateAgentStopBody - the /agent-stop request body validator.
 */

import { describe, it, expect } from 'vitest';
import { validateAgentStopBody } from '../../src/routes/realtime-validators';
import { MAX_TURN_ID_LENGTH } from '../../src/constants/security-limits';

function agentStopRequest(body: unknown): Request {
  return new Request('http://localhost/agent-stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('validateAgentStopBody', () => {
  it('parses a body with only agentId', async () => {
    const result = await validateAgentStopBody(agentStopRequest({ agentId: 'a' }), null, []);
    expect(result).toEqual({ agentId: 'a', turnId: undefined, reason: undefined });
  });

  it('parses a body with only turnId', async () => {
    const result = await validateAgentStopBody(agentStopRequest({ turnId: 't' }), null, []);
    expect(result).toEqual({ agentId: undefined, turnId: 't', reason: undefined });
  });

  it('rejects a malformed turnId even when agentId is valid', async () => {
    const result = await validateAgentStopBody(
      agentStopRequest({ agentId: 'a', turnId: 123 }),
      null,
      [],
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('rejects a whitespace-only turnId even when agentId is valid', async () => {
    const result = await validateAgentStopBody(
      agentStopRequest({ agentId: 'a', turnId: '   ' }),
      null,
      [],
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('rejects a body with neither field', async () => {
    const result = await validateAgentStopBody(agentStopRequest({}), null, []);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('accepts a turnId of exactly the maximum length', async () => {
    const turnId = 'a'.repeat(MAX_TURN_ID_LENGTH);
    const result = await validateAgentStopBody(agentStopRequest({ turnId }), null, []);
    expect(result).toEqual({ agentId: undefined, turnId, reason: undefined });
  });

  it('rejects a turnId one character over the maximum length', async () => {
    const turnId = 'a'.repeat(MAX_TURN_ID_LENGTH + 1);
    const result = await validateAgentStopBody(agentStopRequest({ turnId }), null, []);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('accepts an over-length turnId that trims down to the cap', async () => {
    const turnId = `  ${'a'.repeat(MAX_TURN_ID_LENGTH)}  `;
    const result = await validateAgentStopBody(agentStopRequest({ turnId }), null, []);
    expect(result).toEqual({ agentId: undefined, turnId, reason: undefined });
  });
});
