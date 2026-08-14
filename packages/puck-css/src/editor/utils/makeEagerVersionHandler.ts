export function makeEagerVersionHandler(
  needsVersionRef: { current: boolean },
  getParams: () => { siteId: string; branchId: string; documentId: string | null },
  deps: {
    createVersion: (siteId: string, params: { documentId: string; branchId: string; snapshot: Record<string, unknown> }) => Promise<unknown>;
    refreshVersions: () => Promise<void>;
  },
) {
  return function handleEagerVersion(snapshot: Record<string, unknown>): void {
    if (!needsVersionRef.current) return;
    const { siteId, branchId, documentId } = getParams();
    if (!documentId) return;
    needsVersionRef.current = false;
    void deps.createVersion(siteId, { documentId, branchId, snapshot })
      .then(() => deps.refreshVersions());
  };
}
