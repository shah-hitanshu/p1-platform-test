/**
 * Client-safe HTTP JSON datasource fetcher.
 * This file must NOT import from the DAL or any server-only modules
 * so it can be safely re-exported through the client barrel.
 */

import type { HttpJsonRemoteDatasourceDefinition } from "./user-remote-datasource-types";
import { isUnsafeKey } from "../paths";

const HTTP_TIMEOUT_MS = 8000;

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (isUnsafeKey(p)) return undefined;
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function resolveTokenTemplates(
  input: string,
  context: Record<string, unknown>
): string {
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, rawPath: string) => {
    const trimmed = String(rawPath).trim();
    const sourceName = trimmed.split(".")[0] ?? "";
    const pathWithinSource = trimmed.slice(sourceName.length + 1);
    const sourceRow = context[sourceName as string];
    if (!sourceRow || typeof sourceRow !== "object" || Array.isArray(sourceRow)) {
      return "";
    }
    const value = pathWithinSource
      ? getByPath(sourceRow as Record<string, unknown>, pathWithinSource)
      : sourceRow;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "";
  });
}

export async function fetchHttpJsonRemoteDatasource(
  definition: HttpJsonRemoteDatasourceDefinition,
  contextVars: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  try {
    const urlRaw = resolveTokenTemplates(definition.urlTemplate, contextVars);
    if (!urlRaw) return {};
    const url = new URL(urlRaw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return {};
    for (const [k, v] of Object.entries(definition.query ?? {})) {
      const resolved = resolveTokenTemplates(v, contextVars);
      if (resolved) {
        url.searchParams.set(k, resolved);
      }
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(definition.headers ?? {})) {
      const resolved = resolveTokenTemplates(v, contextVars);
      if (resolved) {
        headers.set(k, resolved);
      }
    }
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url.toString(), {
        method: "GET",
        headers,
        signal: ctrl.signal,
      });
      if (!res.ok) return {};
      const json: unknown = await res.json();
      if (json && typeof json === "object" && !Array.isArray(json)) {
        return json as Record<string, unknown>;
      }
      if (Array.isArray(json)) {
        return { items: json };
      }
      return { value: json };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return {};
  }
}
