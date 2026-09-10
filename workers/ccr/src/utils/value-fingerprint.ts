/**
 * Fingerprints of prop values.
 *
 * A fingerprint identifies one value without naming where it was read from, so
 * two callers on different branches agree on whether a prop still holds the value
 * they each saw. Values are arbitrary JSON — a string, a nested object, an array
 * of blocks — so equality is taken over a serialisation with object keys sorted,
 * making it independent of the key order a snapshot happens to store.
 */

import stringify from 'fast-json-stable-stringify';
import { sha256Hex } from './hash';

/**
 * An absent prop. A bare token rather than a JSON value, so it cannot collide with
 * any value a prop could hold, `null` included.
 */
const ABSENT = '__absent__';

/** An absent value serialises to no JSON, which the declared return type omits. */
const serialise = stringify as (value: unknown) => string | undefined;

/**
 * JSON with object keys sorted at every depth. Arrays keep their order, which
 * carries meaning. Keys holding no value are dropped, so adding one leaves the
 * serialisation alone, matching how the prop diff reads them.
 */
export function stableStringify(value: unknown): string {
  return serialise(value) ?? ABSENT;
}

/** The fingerprint of one prop value, prefixed with the digest that produced it. */
export async function fingerprintValue(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(stableStringify(value)));
}
