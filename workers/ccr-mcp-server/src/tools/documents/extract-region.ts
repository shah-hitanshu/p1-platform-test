export function extractRegion(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('/').filter((p) => p !== '');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
