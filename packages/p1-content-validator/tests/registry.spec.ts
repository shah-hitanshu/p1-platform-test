import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registryComponentKey, snapshotToComponentSchema, fetchRegistry } from '../src/index.js';

/**
 * Registry casing regression (PCC-3437 follow-up).
 *
 * Registry document paths (e.g. "_registry/components/LeadCapture") are
 * lowercased server-side on write, but the descriptor snapshot body's own
 * `name` field preserves the component's real, original case. Registry
 * building must key/report by that preserved-case name — not the
 * lowercased, path-derived one — while lookups stay case-insensitive via
 * `registryComponentKey` (mirroring the client-side pattern from
 * puck-css-integration#122).
 */

describe('registryComponentKey', () => {
  it('lowercases names for case-insensitive lookup keys', () => {
    expect(registryComponentKey('LeadCapture')).toBe('leadcapture');
    expect(registryComponentKey('leadcapture')).toBe('leadcapture');
    expect(registryComponentKey('LEADCAPTURE')).toBe('leadcapture');
  });
});

describe('snapshotToComponentSchema', () => {
  it('takes the name from the snapshot body, which preserves the real casing', () => {
    const schema = snapshotToComponentSchema({
      name: 'LeadCapture',
      defaultProps: { headline: '' },
    });
    expect(schema?.name).toBe('LeadCapture');
  });

  // Previously this fell back to the caller-supplied (path-derived) name. Paths
  // are lowercased server-side, so that fallback minted "leadcapture" and
  // advertised it as a usable component type — a casing Puck cannot resolve
  // (PCC-3561). A descriptor with no name is corrupt; callers must skip it.
  it('returns null when the snapshot has no name field', () => {
    expect(snapshotToComponentSchema({ defaultProps: {} })).toBeNull();
  });

  it('returns null for an empty name', () => {
    expect(snapshotToComponentSchema({ name: '', defaultProps: {} })).toBeNull();
  });
});

describe('fetchRegistry', () => {
  const mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);

  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  function createMockResponse(ok: boolean, data: unknown): Response {
    return { ok, json: () => Promise.resolve(data) } as Response;
  }

  it('keys schemas case-insensitively and preserves the descriptor\'s original-case name', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      documents: [{ id: 'doc-lc', path: '_registry/components/leadcapture' }],
    }));
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      snapshot: { name: 'LeadCapture', defaultProps: { headline: '' } },
    }));

    const schemas = await fetchRegistry('http://localhost:8787', 'site-unique-1', 'branch-1', {
      token: 'test-token',
    });

    // The map key is normalized to lowercase for case-insensitive lookup...
    expect(schemas.leadcapture).toBeDefined();
    expect(schemas.LeadCapture).toBeUndefined();
    // ...while the schema's own `name` field preserves the real casing for display.
    expect(schemas.leadcapture.name).toBe('LeadCapture');
  });
});
