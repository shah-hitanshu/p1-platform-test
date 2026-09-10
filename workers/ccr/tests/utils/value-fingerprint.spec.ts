import { describe, it, expect } from 'vitest';
import { fingerprintValue, stableStringify } from '../../src/utils/value-fingerprint';

describe('stableStringify', () => {
  it('serialises object keys in the same order however they were built', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('sorts keys at every depth', () => {
    const one = { outer: { z: 1, a: { y: 2, b: 3 } } };
    const other = { outer: { a: { b: 3, y: 2 }, z: 1 } };
    expect(stableStringify(one)).toBe(stableStringify(other));
  });

  it('keeps array order, which carries meaning', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('drops keys with no value, so adding one leaves the serialisation alone', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('fingerprintValue', () => {
  it('names the digest that produced it', async () => {
    expect(await fingerprintValue('hello')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('gives equal values the same fingerprint', async () => {
    expect(await fingerprintValue({ a: [1, { b: 'c' }] })).toBe(
      await fingerprintValue({ a: [1, { b: 'c' }] }),
    );
  });

  it('gives a value and the same value under reordered keys one fingerprint', async () => {
    expect(await fingerprintValue({ title: 'Hi', level: 'h1' })).toBe(
      await fingerprintValue({ level: 'h1', title: 'Hi' }),
    );
  });

  it('separates an absent prop from every value one could hold', async () => {
    const absent = await fingerprintValue(undefined);
    for (const value of [null, '', 0, false, 'absent', [], {}]) {
      expect(await fingerprintValue(value)).not.toBe(absent);
    }
  });

  it('separates values that serialise alike in loose comparisons', async () => {
    const fingerprints = await Promise.all(
      [null, '', 0, false, '0', 'null'].map(fingerprintValue),
    );
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('separates a string from the same text nested in an object', async () => {
    expect(await fingerprintValue('a')).not.toBe(await fingerprintValue({ a: 'a' }));
  });
});
