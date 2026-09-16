import { describe, it, expect } from 'vitest';
import { NoDatabaseConfiguredError, resolveConnection } from '../../src/db/resolve-connection';

const hd = (connectionString: string) => ({ connectionString }) as unknown as Hyperdrive;
const env = { HYPERDRIVE: hd('cached'), HYPERDRIVE_NOCACHE: hd('fresh') };

describe('resolveConnection', () => {
  it('uses the no-cache pool when the caller requires a fresh read', () => {
    expect(resolveConnection(env, true)).toEqual({ connectionString: 'fresh', isHyperdrive: true });
  });

  it('uses the cached pool by default', () => {
    expect(resolveConnection(env).connectionString).toBe('cached');
    expect(resolveConnection(env, false).connectionString).toBe('cached');
  });

  it('falls back to the cached pool when no-cache is not bound', () => {
    expect(resolveConnection({ HYPERDRIVE: hd('cached') }, true).connectionString).toBe('cached');
  });

  it('falls back to the direct connection string when Hyperdrive is not bound', () => {
    expect(resolveConnection({ POSTGRES_CONNECTION_STRING: 'postgres://local' }, true)).toEqual({
      connectionString: 'postgres://local',
      isHyperdrive: false,
    });
  });

  it('throws when nothing is configured', () => {
    expect(() => resolveConnection({})).toThrow(NoDatabaseConfiguredError);
    expect(() => resolveConnection({ POSTGRES_CONNECTION_STRING: '' })).toThrow(NoDatabaseConfiguredError);
  });
});
