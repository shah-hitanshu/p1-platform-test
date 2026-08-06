import type { RemoteDatasourceScope } from "../../../data/remote-datasources/user-remote-datasource-types";

export type UiRemoteDatasource = {
  id: string;
  label: string;
  description: string;
  urlTemplate: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  fields: { path: string; description: string }[];
};

export type ScopedUiRemoteDatasource = UiRemoteDatasource & { scope: RemoteDatasourceScope };

export function toLines(rec?: Record<string, string>): string {
  return Object.entries(rec ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function parseRecordLines(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const key = raw.slice(0, eq).trim();
    const val = raw.slice(eq + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

export function parseFieldLines(value: string): { path: string; description: string }[] {
  const out: { path: string; description: string }[] = [];
  for (const line of value.split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    const sep = raw.indexOf("|");
    if (sep <= 0) continue;
    const path = raw.slice(0, sep).trim();
    const description = raw.slice(sep + 1).trim();
    if (path && description) {
      out.push({ path, description });
    }
  }
  return out;
}
