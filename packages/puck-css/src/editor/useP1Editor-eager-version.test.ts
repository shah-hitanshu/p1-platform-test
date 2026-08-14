import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEagerVersionHandler } from './utils/makeEagerVersionHandler.js';

describe('makeEagerVersionHandler', () => {
  let needsVersionRef: { current: boolean };
  let createVersion: (siteId: string, params: { documentId: string; branchId: string; snapshot: Record<string, unknown> }) => Promise<unknown>;
  let refreshVersions: () => Promise<void>;
  let getParams: () => { siteId: string; branchId: string; documentId: string | null };

  beforeEach(() => {
    needsVersionRef = { current: false };
    createVersion = vi.fn<[string, { documentId: string; branchId: string; snapshot: Record<string, unknown> }], Promise<unknown>>().mockResolvedValue(undefined);
    refreshVersions = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
    getParams = () => ({ siteId: 'site-1', branchId: 'main', documentId: 'doc-1' });
  });

  it('does nothing when ref is false', () => {
    const handler = makeEagerVersionHandler(needsVersionRef, getParams, { createVersion, refreshVersions });
    handler({ zones: {}, content: [] });
    expect(createVersion).not.toHaveBeenCalled();
  });

  it('calls createVersion with correct params when ref is true', () => {
    needsVersionRef.current = true;
    const snapshot = { zones: {}, content: [{ type: 'Text' }] };
    const handler = makeEagerVersionHandler(needsVersionRef, getParams, { createVersion, refreshVersions });
    handler(snapshot);
    expect(createVersion).toHaveBeenCalledOnce();
    expect(createVersion).toHaveBeenCalledWith('site-1', {
      documentId: 'doc-1',
      branchId: 'main',
      snapshot,
    });
  });

  it('clears the ref immediately so subsequent calls are no-ops', () => {
    needsVersionRef.current = true;
    const handler = makeEagerVersionHandler(needsVersionRef, getParams, { createVersion, refreshVersions });
    handler({ zones: {}, content: [] });
    expect(needsVersionRef.current).toBe(false);
    handler({ zones: {}, content: [] });
    expect(createVersion).toHaveBeenCalledOnce();
  });

  it('calls refreshVersions after createVersion resolves', async () => {
    needsVersionRef.current = true;
    const handler = makeEagerVersionHandler(needsVersionRef, getParams, { createVersion, refreshVersions });
    handler({ zones: {}, content: [] });
    await new Promise(r => setTimeout(r, 0));
    expect(refreshVersions).toHaveBeenCalledOnce();
  });

  it('does nothing when documentId is null', () => {
    needsVersionRef.current = true;
    getParams = () => ({ siteId: 'site-1', branchId: 'main', documentId: null });
    const handler = makeEagerVersionHandler(needsVersionRef, getParams, { createVersion, refreshVersions });
    handler({ zones: {}, content: [] });
    expect(createVersion).not.toHaveBeenCalled();
  });
});
