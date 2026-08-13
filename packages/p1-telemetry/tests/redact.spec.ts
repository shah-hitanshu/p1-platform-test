import { describe, expect, it } from 'vitest';
import { buildAllowList, redactFields, serializeError } from '../src/redact.js';

const allowed = buildAllowList();

describe('redactFields', () => {
  it('keeps allow-listed fields and drops everything else by name', () => {
    const out = redactFields(
      { site_id: 'abc', duration_ms: 12, page_content: 'secret prose', title: 'My Page' },
      allowed,
    );
    expect(out).toEqual({
      site_id: 'abc',
      duration_ms: 12,
      _dropped: ['page_content', 'title'],
    });
  });

  it('reports dropped names but never dropped values', () => {
    const out = redactFields({ puckData: { root: { title: 'leak me' } } }, allowed);
    expect(JSON.stringify(out)).not.toContain('leak me');
    expect(out?._dropped).toEqual(['puckData']);
  });

  it('re-checks nested objects, so nesting is not an escape hatch', () => {
    const extended = buildAllowList(['payload']);
    const out = redactFields({ payload: { site_id: 'ok', body: 'nope' } }, extended);
    expect(out?.payload).toEqual({ site_id: 'ok', _dropped: ['body'] });
  });

  // Credential-shaped fixtures are assembled at runtime rather than written as
  // literals, so no string in this file matches a secret-scanner pattern.
  const fakeJwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghij'].join('.');
  const fakeApiKey = `${'sk'}-${'a'.repeat(24)}`;
  const fakeBearer = `${'Bear'}er ${'abcdef1234567890'}`;
  const fakeEmail = ['someone', 'example.com'].join('@');

  it('scrubs credentials that reach an allow-listed field', () => {
    const out = redactFields({ reason: `rejected token ${fakeJwt}` }, allowed);
    expect(out?.reason).toBe('rejected token [redacted:jwt]');
  });

  it('scrubs api keys', () => {
    const out = redactFields({ reason: `key ${fakeApiKey} denied` }, allowed);
    expect(out?.reason).toBe('key [redacted:key] denied');
  });

  it('scrubs emails and bearer tokens', () => {
    const out = redactFields(
      { reason: `user ${fakeEmail} sent Authorization ${fakeBearer}` },
      allowed,
    );
    expect(out?.reason).not.toContain(fakeEmail);
    expect(out?.reason).toContain('[redacted:email]');
    expect(out?.reason).toContain('[redacted:auth]');
  });

  it('truncates long strings and caps arrays', () => {
    const long = 'x'.repeat(700);
    const out = redactFields({ reason: long, tool_calls: Array(30).fill('t') }, allowed);
    expect(String(out?.reason)).toContain('[truncated 188]');
    expect((out?.tool_calls as unknown[]).length).toBe(21);
    expect((out?.tool_calls as unknown[])[20]).toBe('[+10 more]');
  });

  it('caps object nesting rather than recursing without bound', () => {
    const extended = buildAllowList(['a', 'b', 'c', 'd']);
    // Three levels of objects are walked; the fourth is replaced.
    const out = redactFields({ a: { b: { c: { d: { site_id: 'deep' } } } } }, extended);
    expect(JSON.stringify(out)).toContain('depth-capped');
    expect(JSON.stringify(out)).not.toContain('deep');
  });

  it('still records a primitive at the depth limit, since it needs no recursion', () => {
    const extended = buildAllowList(['a', 'b', 'c', 'd']);
    const out = redactFields({ a: { b: { c: { d: 1 } } } }, extended);
    expect(out).toEqual({ a: { b: { c: { d: 1 } } } });
  });

  it('returns undefined when there is nothing to log', () => {
    expect(redactFields(undefined, allowed)).toBeUndefined();
    expect(redactFields({}, allowed)).toBeUndefined();
  });
});

describe('serializeError', () => {
  it('extracts the fields JSON.stringify would silently lose', () => {
    // JSON.stringify(new Error('boom')) is '{}' — Error's own fields are non-enumerable.
    const out = serializeError(new TypeError('boom'));
    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('boom');
    expect(out.stack).toContain('boom');
  });

  it('walks cause chains up to a depth cap', () => {
    const root = new Error('root');
    const mid = new Error('mid', { cause: root });
    const top = new Error('top', { cause: mid });
    const out = serializeError(top);
    expect(out.cause?.message).toBe('mid');
    expect(out.cause?.cause?.message).toBe('root');
  });

  it('never reads an attached request/response that could carry auth headers', () => {
    const apiError = Object.assign(new Error('401'), {
      request: { headers: { authorization: 'Bearer super-secret-token' } },
    });
    expect(JSON.stringify(serializeError(apiError))).not.toContain('super-secret-token');
  });

  it('handles non-Error throws', () => {
    expect(serializeError('just a string').message).toBe('just a string');
    expect(serializeError(undefined).name).toBe('NonError');
    expect(serializeError({ name: 'Weird', message: 'shape' })).toEqual({
      name: 'Weird',
      message: 'shape',
    });
  });

  it('scrubs credentials out of error messages', () => {
    const key = `${'sk'}-${'abcdefghijklmnopqrstuv'}`;
    const out = serializeError(new Error(`failed for ${key}`));
    expect(out.message).toBe('failed for [redacted:key]');
  });
});

describe('serializeError with AggregateError', () => {
  /**
   * The message is the fixed string "All promises were rejected"; `errors` is the only
   * account of what actually failed. Dropping it left nothing to debug from.
   */
  it('preserves the aggregated failures', () => {
    const out = serializeError(
      new AggregateError([new TypeError('dns'), new RangeError('timeout')], 'all failed'),
    );
    expect(out.errors?.map((e) => e.name)).toEqual(['TypeError', 'RangeError']);
    expect(out.errors?.[0]?.message).toBe('dns');
  });

  it('caps the list so one failed Promise.any cannot flood a line', () => {
    const many = Array.from({ length: 50 }, (_, i) => new Error(`fail ${String(i)}`));
    expect(serializeError(new AggregateError(many)).errors).toHaveLength(5);
  });

  it('redacts inside aggregated errors like anywhere else', () => {
    const out = serializeError(new AggregateError([new Error('token eyJabcdefgh.ijklmnop.qrst')]));
    expect(out.errors?.[0]?.message).toContain('[redacted:jwt]');
  });

  it('leaves a plain error without an errors array', () => {
    expect(serializeError(new Error('boom')).errors).toBeUndefined();
  });
});
