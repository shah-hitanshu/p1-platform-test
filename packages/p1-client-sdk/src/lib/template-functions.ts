function toFiniteInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

export function toText(value: unknown): string {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "";
}

type SafeTemplateFn = (args: unknown[]) => unknown;

export const TEMPLATE_FUNCTIONS: Record<string, SafeTemplateFn> = {
  trim: ([value]) => toText(value).trim(),
  toLowerCase: ([value]) => toText(value).toLowerCase(),
  toUpperCase: ([value]) => toText(value).toUpperCase(),
  slice: ([value, start, end]) => {
    const s = toFiniteInt(start);
    if (s === undefined) return "";
    const e = end === undefined ? undefined : toFiniteInt(end);
    if (end !== undefined && e === undefined) return "";
    return toText(value).slice(s, e);
  },
  substring: ([value, start, end]) => {
    const s = toFiniteInt(start);
    if (s === undefined) return "";
    const e = end === undefined ? undefined : toFiniteInt(end);
    if (end !== undefined && e === undefined) return "";
    return toText(value).substring(s, e);
  },
  replace: ([value, search, replacement]) => {
    if (typeof search !== "string" || typeof replacement !== "string") return "";
    return toText(value).replace(search, replacement);
  },
  replaceAll: ([value, search, replacement]) => {
    if (typeof search !== "string" || typeof replacement !== "string") return "";
    return toText(value).replaceAll(search, replacement);
  },
  padStart: ([value, length, fill]) => {
    const len = toFiniteInt(length);
    if (len === undefined) return "";
    if (fill !== undefined && typeof fill !== "string") return "";
    return fill === undefined
      ? toText(value).padStart(len)
      : toText(value).padStart(len, fill as string);
  },
  padEnd: ([value, length, fill]) => {
    const len = toFiniteInt(length);
    if (len === undefined) return "";
    if (fill !== undefined && typeof fill !== "string") return "";
    return fill === undefined
      ? toText(value).padEnd(len)
      : toText(value).padEnd(len, fill as string);
  },
  default: ([value, fallback]) => {
    const shouldUseFallback = value == null || value === "";
    return shouldUseFallback ? fallback : value;
  },
  truncate: ([value, maxLen, suffix]) => {
    const max = toFiniteInt(maxLen);
    if (max === undefined || max < 0) return "";
    if (suffix !== undefined && typeof suffix !== "string") return "";
    const sfx = typeof suffix === "string" ? suffix : "...";
    const text = toText(value);
    if (text.length <= max) return text;
    if (max <= sfx.length) return sfx.slice(0, max);
    return `${text.slice(0, max - sfx.length)}${sfx}`;
  },
};
