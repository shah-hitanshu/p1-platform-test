import { describe, it, expect } from 'vitest';
import {
  recordStoppedTurn,
  isTurnStopped,
  serializeStoppedTurns,
  deserializeStoppedTurns,
  normalizeTurnId,
  type StoppedTurns,
} from '../../src/durable-objects/stopped-turns';
import { MAX_TURN_ID_LENGTH } from '../../src/constants/security-limits';

const T0 = 1_700_000_000_000;
const TTL = 30 * 60 * 1000;

describe('stopped turns', () => {
  it('bars a turn that was stopped', () => {
    const turns: StoppedTurns = new Map();
    recordStoppedTurn(turns, 'turn-1', T0);

    expect(isTurnStopped(turns, 'turn-1', T0 + 1_000)).toBe(true);
  });

  it('leaves other turns alone', () => {
    const turns: StoppedTurns = new Map();
    recordStoppedTurn(turns, 'turn-1', T0);

    expect(isTurnStopped(turns, 'turn-2', T0 + 1_000)).toBe(false);
  });

  it('treats a missing turn id as not stopped', () => {
    const turns: StoppedTurns = new Map();
    recordStoppedTurn(turns, 'turn-1', T0);

    expect(isTurnStopped(turns, null, T0)).toBe(false);
    expect(isTurnStopped(turns, '', T0)).toBe(false);
  });

  it('forgets a stop once no live turn could still carry its id', () => {
    const turns: StoppedTurns = new Map();
    recordStoppedTurn(turns, 'turn-1', T0);

    expect(isTurnStopped(turns, 'turn-1', T0 + TTL + 1)).toBe(false);
    expect(turns.has('turn-1')).toBe(false);
  });

  it('caps the map, dropping the oldest stop first', () => {
    const turns: StoppedTurns = new Map();
    for (let i = 0; i < 55; i++) recordStoppedTurn(turns, `turn-${String(i)}`, T0 + i);

    expect(turns.size).toBe(50);
    expect(isTurnStopped(turns, 'turn-0', T0 + 100)).toBe(false);
    expect(isTurnStopped(turns, 'turn-54', T0 + 100)).toBe(true);
  });

  it('keeps a re-recorded stop, evicting the oldest untouched one', () => {
    const turns: StoppedTurns = new Map();
    for (let i = 0; i < 50; i++) recordStoppedTurn(turns, `turn-${String(i)}`, T0 + i);

    recordStoppedTurn(turns, 'turn-0', T0 + 1_000);
    recordStoppedTurn(turns, 'turn-new', T0 + 1_001);

    expect(turns.size).toBe(50);
    expect(isTurnStopped(turns, 'turn-0', T0 + 2_000)).toBe(true);
    expect(isTurnStopped(turns, 'turn-1', T0 + 2_000)).toBe(false);
    expect(isTurnStopped(turns, 'turn-new', T0 + 2_000)).toBe(true);
  });

  it('sweeps expired entries when a new stop is recorded', () => {
    const turns: StoppedTurns = new Map();
    recordStoppedTurn(turns, 'old', T0);
    recordStoppedTurn(turns, 'new', T0 + TTL + 1);

    expect(turns.has('old')).toBe(false);
    expect(turns.has('new')).toBe(true);
  });

  it('round-trips through storage', () => {
    const turns: StoppedTurns = new Map();
    recordStoppedTurn(turns, 'turn-1', T0);

    const restored = deserializeStoppedTurns(serializeStoppedTurns(turns));

    expect(isTurnStopped(restored, 'turn-1', T0 + 1_000)).toBe(true);
  });

  it('restores an empty map from anything unreadable', () => {
    expect(deserializeStoppedTurns(undefined).size).toBe(0);
    expect(deserializeStoppedTurns('not json').size).toBe(0);
    expect(deserializeStoppedTurns('{"turn-1":"soon"}').size).toBe(0);
  });

  describe('normalizeTurnId', () => {
    it('trims surrounding whitespace', () => {
      expect(normalizeTurnId('  turn-abc  ')).toBe('turn-abc');
    });

    it('truncates an over-length id', () => {
      const long = 'a'.repeat(MAX_TURN_ID_LENGTH + 10);
      expect(normalizeTurnId(long)).toBe(long.slice(0, MAX_TURN_ID_LENGTH));
    });

    it('treats empty, whitespace-only, null, and undefined as absent', () => {
      expect(normalizeTurnId('')).toBeUndefined();
      expect(normalizeTurnId('   ')).toBeUndefined();
      expect(normalizeTurnId(null)).toBeUndefined();
      expect(normalizeTurnId(undefined)).toBeUndefined();
    });

    it('replaces an interior CR/LF with a space', () => {
      expect(normalizeTurnId('turn\r\nabc')).toBe('turn  abc');
    });

    it('treats a value that is only CR/LF as absent', () => {
      expect(normalizeTurnId('\r\n')).toBeUndefined();
    });
  });
});
