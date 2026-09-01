/**
 * Puck's `loadOverrides` wraps each plugin's field renderer by writing it back
 * into the `fieldTypes` object it was handed, and it runs again whenever the
 * plugin array changes identity. A `fieldTypes` that outlives one run therefore
 * collects a wrapper per run, and the plugin's control renders once per copy.
 *
 * Reading `fieldTypes` here yields a fresh shallow copy, so every run wraps its
 * own object while the overrides value stays referentially stable — Puck
 * rebuilds every override component when that reference changes.
 */
export function withFreshFieldTypes<T extends object>(overrides: T): T {
  const { fieldTypes, ...rest } = overrides as { fieldTypes?: Record<string, unknown> };
  if (!fieldTypes) return overrides;

  return Object.defineProperty(rest, 'fieldTypes', {
    get: () => ({ ...fieldTypes }),
    enumerable: true,
    configurable: true,
  }) as T;
}
