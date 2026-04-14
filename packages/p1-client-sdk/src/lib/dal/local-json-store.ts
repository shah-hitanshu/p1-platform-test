import fs from "fs";

import type { RemoteDatasourceDefStore, EditorMetaStore, PageStore } from "./types";

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data));
}

export function createLocalPageStore(filePath: string): PageStore {
  return {
    get(path) {
      return readJsonObject(filePath)[path];
    },
    set(path, value) {
      const doc = readJsonObject(filePath);
      doc[path] = value;
      writeJson(filePath, doc);
    },
    delete(path) {
      const doc = readJsonObject(filePath);
      delete doc[path];
      writeJson(filePath, doc);
    },
    has(path) {
      return readJsonObject(filePath)[path] !== undefined;
    },
    keys() {
      return Object.keys(readJsonObject(filePath));
    },
  };
}

export function createLocalEditorMetaStore(filePath: string): EditorMetaStore {
  return {
    get(path) {
      const row = readJsonObject(filePath)[path];
      if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
      return row as Record<string, unknown>;
    },
    set(path, row) {
      const doc = readJsonObject(filePath);
      doc[path] = row;
      writeJson(filePath, doc);
    },
    delete(path) {
      const doc = readJsonObject(filePath);
      delete doc[path];
      writeJson(filePath, doc);
    },
  };
}

export function createLocalRemoteDatasourceDefStore(filePath: string): RemoteDatasourceDefStore {
  return {
    list() {
      const doc = readJsonObject(filePath);
      return Array.isArray(doc.remoteDatasources) ? doc.remoteDatasources : [];
    },
    save(remoteDatasources) {
      writeJson(filePath, { remoteDatasources });
    },
  };
}
