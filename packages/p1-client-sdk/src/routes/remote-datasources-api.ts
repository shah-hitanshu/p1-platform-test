import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  deleteGlobalRemoteDatasource,
  deletePageRemoteDatasource,
  idConflictsForRemoteDatasourceScope,
  listRemoteDatasourcesForPage,
  normalizeRemoteDatasourceDefinition,
  upsertGlobalRemoteDatasource,
  upsertPageRemoteDatasource,
} from "../lib/remote-datasources/user-remote-datasource-store";
import type { RemoteDatasourceScope } from "../lib/remote-datasources/user-remote-datasource-types";
import { normalizePath } from "../lib/paths";

export { getRemoteDatasources as GET, postRemoteDatasources as POST, deleteRemoteDatasources as DELETE };

export async function getRemoteDatasources(request: Request) {
  const url = new URL(request.url);
  const path = normalizePath(url.searchParams.get("path") ?? "/");
  if (!path) {
    return NextResponse.json(
      { ok: false, error: "invalid_path" },
      { status: 400 },
    );
  }
  const data = listRemoteDatasourcesForPage(path);
  return NextResponse.json({
    ok: true,
    path,
    global: data.global,
    page: data.page,
  });
}

export async function postRemoteDatasources(request: Request) {
  let body: {
    scope?: RemoteDatasourceScope;
    path?: string;
    definition?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const scope = body.scope;
  if (scope !== "global" && scope !== "page") {
    return NextResponse.json(
      { ok: false, error: "invalid_scope" },
      { status: 400 },
    );
  }

  const path = normalizePath(body.path ?? "/");
  if (!path) {
    return NextResponse.json(
      { ok: false, error: "invalid_path" },
      { status: 400 },
    );
  }

  const definition = normalizeRemoteDatasourceDefinition(body.definition);

  if (!definition) {
    return NextResponse.json(
      { ok: false, error: "invalid_definition" },
      { status: 400 },
    );
  } else if (idConflictsForRemoteDatasourceScope(scope, definition.id, path)) {
    return NextResponse.json(
      { ok: false, error: "id_conflict" },
      { status: 409 },
    );
  }

  if (scope === "global") {
    upsertGlobalRemoteDatasource(definition);
  } else {
    upsertPageRemoteDatasource(path, definition);
  }

  revalidatePath(path);
  return NextResponse.json({ ok: true, scope, path, id: definition.id });
}

export async function deleteRemoteDatasources(request: Request) {
  let body: { scope?: RemoteDatasourceScope; path?: string; id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const scope = body.scope;
  if (scope !== "global" && scope !== "page") {
    return NextResponse.json(
      { ok: false, error: "invalid_scope" },
      { status: 400 },
    );
  }

  const path = normalizePath(body.path ?? "/");
  if (!path) {
    return NextResponse.json(
      { ok: false, error: "invalid_path" },
      { status: 400 },
    );
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "invalid_id" },
      { status: 400 },
    );
  }

  if (scope === "global") {
    deleteGlobalRemoteDatasource(id);
  } else {
    deletePageRemoteDatasource(path, id);
  }

  revalidatePath(path);
  return NextResponse.json({ ok: true, scope, path, id });
}
