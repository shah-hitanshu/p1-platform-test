/** The 8-4-4-4-12 hex shape, for composing into larger patterns. */
export const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'i');

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
