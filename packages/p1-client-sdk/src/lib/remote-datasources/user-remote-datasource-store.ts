import { remoteDatasourceDefStore } from "../dal";
import {
  getPageEditorMetaRow,
  setPageEditorMetaRow,
} from "../page-editor-meta";
import type {
  RemoteDatasourceScope,
  HttpJsonRemoteDatasourceDefinition,
} from "./user-remote-datasource-types";

const RESERVED_IDS = new Set(["urlParams"]);
const ID_REGEX = /^[a-z][a-z0-9_]*$/;

function cleanField(field: unknown): { path: string; description: string } | null {
  if (!field || typeof field !== "object" || Array.isArray(field)) return null;
  const f = field as Record<string, unknown>;
  const path = typeof f.path === "string" ? f.path.trim() : "";
  const description = typeof f.description === "string" ? f.description.trim() : "";
  if (!path || !description) return null;
  return { path, description };
}

const SAFE_IDENTIFIER_KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9_\-]*$/;

function cleanStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, string> = Object.create(null);
  for (const k of Object.keys(src)) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    const key = String(k).trim();
    if (!SAFE_IDENTIFIER_KEY_REGEX.test(key)) continue;
    const val = typeof src[k] === "string" ? (src[k] as string).trim() : "";
    if (key && val) {
      out[key] = val;
    }
  }
  return out;
}

export function normalizeRemoteDatasourceDefinition(
  input: unknown
): HttpJsonRemoteDatasourceDefinition | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const row = input as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const description = typeof row.description === "string" ? row.description.trim() : "";
  const urlTemplate = typeof row.urlTemplate === "string" ? row.urlTemplate.trim() : "";
  const fieldsRaw = Array.isArray(row.fields) ? row.fields : [];
  const fields = fieldsRaw.map(cleanField).filter((f): f is { path: string; description: string } => !!f);
  const headers = cleanStringRecord(row.headers);
  const query = cleanStringRecord(row.query);

  if (!ID_REGEX.test(id) || !label || !description || !urlTemplate || fields.length === 0) {
    return null;
  }
  if (RESERVED_IDS.has(id)) return null;

  const out: HttpJsonRemoteDatasourceDefinition = {
    id,
    label,
    description,
    urlTemplate,
    fields,
  };
  if (Object.keys(headers).length > 0) out.headers = headers;
  if (Object.keys(query).length > 0) out.query = query;
  return out;
}

function readNormalizedGlobalList(): HttpJsonRemoteDatasourceDefinition[] {
  return remoteDatasourceDefStore.list()
    .map((row: unknown) => normalizeRemoteDatasourceDefinition(row))
    .filter((d): d is HttpJsonRemoteDatasourceDefinition => !!d);
}

export function listGlobalRemoteDatasources(): HttpJsonRemoteDatasourceDefinition[] {
  return readNormalizedGlobalList();
}

export function upsertGlobalRemoteDatasource(def: HttpJsonRemoteDatasourceDefinition): void {
  const next = readNormalizedGlobalList().filter((d) => d.id !== def.id);
  next.push(def);
  next.sort((a, b) => a.id.localeCompare(b.id));
  remoteDatasourceDefStore.save(next);
}

export function deleteGlobalRemoteDatasource(id: string): void {
  const next = readNormalizedGlobalList().filter((d) => d.id !== id);
  remoteDatasourceDefStore.save(next);
}

export function listPageRemoteDatasources(path: string): HttpJsonRemoteDatasourceDefinition[] {
  const row = getPageEditorMetaRow(path);
  const list = Array.isArray(row.datasources) ? row.datasources : [];
  return list
    .map((d) => normalizeRemoteDatasourceDefinition(d))
    .filter((d): d is HttpJsonRemoteDatasourceDefinition => !!d);
}

export function upsertPageRemoteDatasource(
  path: string,
  def: HttpJsonRemoteDatasourceDefinition
): void {
  const row = getPageEditorMetaRow(path);
  const list = Array.isArray(row.datasources) ? row.datasources : [];
  const normalized = list
    .map((d) => normalizeRemoteDatasourceDefinition(d))
    .filter((d): d is HttpJsonRemoteDatasourceDefinition => !!d)
    .filter((d) => d.id !== def.id);
  normalized.push(def);
  normalized.sort((a, b) => a.id.localeCompare(b.id));
  setPageEditorMetaRow(path, { ...row, datasources: normalized });
}

export function deletePageRemoteDatasource(path: string, id: string): void {
  const row = getPageEditorMetaRow(path);
  const list = Array.isArray(row.datasources) ? row.datasources : [];
  const normalized = list
    .map((d) => normalizeRemoteDatasourceDefinition(d))
    .filter((d): d is HttpJsonRemoteDatasourceDefinition => !!d)
    .filter((d) => d.id !== id);
  setPageEditorMetaRow(path, { ...row, datasources: normalized });
}

export function listRemoteDatasourcesForPage(path: string): {
  global: HttpJsonRemoteDatasourceDefinition[];
  page: HttpJsonRemoteDatasourceDefinition[];
} {
  return {
    global: listGlobalRemoteDatasources(),
    page: listPageRemoteDatasources(path),
  };
}

export function idConflictsForRemoteDatasourceScope(
  scope: RemoteDatasourceScope,
  id: string,
  path: string
): boolean {
  if (RESERVED_IDS.has(id)) return true;
  if (scope === "global") {
    return listPageRemoteDatasources(path).some((d) => d.id === id);
  }
  return listGlobalRemoteDatasources().some((d) => d.id === id);
}
