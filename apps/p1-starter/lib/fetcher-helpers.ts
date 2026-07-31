export function getFirstValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = searchParams[key];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export function savedValue(
  savedPreviewParams: Record<string, string>,
  key: string,
): string | undefined {
  const v = savedPreviewParams[key]?.trim();
  return v || undefined;
}
