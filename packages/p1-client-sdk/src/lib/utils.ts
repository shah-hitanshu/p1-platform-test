/** Safely coerce an unknown value to string — returns "" for null, undefined, and non-primitives. */
export function rawValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
