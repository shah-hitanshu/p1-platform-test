/**
 * Lightweight mock CSS API server for E2E tests.
 *
 * Seeds page data from e2e/fixtures/database.json and exposes the
 * endpoints the p1-starter app hits during initialization and rendering.
 *
 * Supports writes (POST for document creation, PUT for version creation)
 * so that the structure page and publish flow work in E2E tests.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "fixtures/database.json");

const SITE_ID = "test-site";
const BRANCH_ID = "branch-main";

interface DocRecord {
  id: string;
  path: string;
  snapshot: Record<string, unknown>;
}

function loadFixtures(): Map<string, DocRecord> {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Record<string, unknown>;
  const docs = new Map<string, DocRecord>();
  let counter = 0;
  for (const [path, data] of Object.entries(raw)) {
    const docPath = path.startsWith("/") ? path.slice(1) : path;
    const id = `doc-${counter++}`;
    docs.set(docPath, { id, path: docPath, snapshot: data as Record<string, unknown> });
  }
  return docs;
}

const docs = loadFixtures();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: "not_found" });
}

function routeMatch(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  console.log(`[mock] ${method} ${pathname}`);

  // GET /api/sites/:siteId/branches — list branches
  const branchList = routeMatch("/api/sites/:siteId/branches", pathname);
  if (branchList && method === "GET") {
    return json(res, 200, {
      branches: [
        {
          id: BRANCH_ID,
          siteId: SITE_ID,
          name: "main",
          isMain: true,
          status: "active",
          sourceBranchId: null,
          sourceCheckpointId: null,
          createdById: "system",
          createdByType: "user",
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }

  // GET /api/sites/:siteId/branches/:branchId/documents — list documents
  const docList = routeMatch("/api/sites/:siteId/branches/:branchId/documents", pathname);
  if (docList && method === "GET") {
    const items = Array.from(docs.values()).map((d) => ({
      id: d.id,
      siteId: SITE_ID,
      path: d.path,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    return json(res, 200, { documents: items });
  }

  // GET /api/sites/:siteId/documents/by-path/:encodedPath — get document by path
  const byPath = routeMatch("/api/sites/:siteId/documents/by-path/:encodedPath", pathname);
  if (byPath && method === "GET") {
    const docPath = decodeURIComponent(byPath.encodedPath);
    const doc = docs.get(docPath);
    if (!doc) return notFound(res);
    return json(res, 200, {
      id: doc.id,
      siteId: SITE_ID,
      path: doc.path,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // GET /api/sites/:siteId/content/:docPath — content delivery endpoint (published view)
  // Path may be multi-segment so we can't use routeMatch; use prefix matching instead.
  const contentPrefix = `/api/sites/${SITE_ID}/content/`;
  if (pathname.startsWith(contentPrefix) && method === "GET") {
    const docPath = pathname.slice(contentPrefix.length);
    const doc = docs.get(docPath);
    if (!doc) return notFound(res);
    return json(res, 200, {
      documentId: doc.id,
      path: doc.path,
      data: doc.snapshot,
      branchId: BRANCH_ID,
      branchName: "main",
      isMainBranch: true,
      versionNumber: 1,
      versionCreatedAt: new Date().toISOString(),
      etag: `"v-${doc.id}"`,
    });
  }

  // GET /api/sites/:siteId/branches/:branchId/documents/:docId/versions/latest
  const versionLatest = routeMatch(
    "/api/sites/:siteId/branches/:branchId/documents/:docId/versions/latest",
    pathname,
  );
  if (versionLatest && method === "GET") {
    const doc = Array.from(docs.values()).find((d) => d.id === versionLatest.docId);
    if (!doc) return notFound(res);
    return json(res, 200, {
      id: "ver-1",
      documentId: doc.id,
      branchId: BRANCH_ID,
      versionNumber: 1,
      snapshot: doc.snapshot,
      crdtState: null,
      source: "api",
      createdById: "system",
      createdByType: "user",
      createdAt: new Date().toISOString(),
    });
  }

  // POST /api/sites/:siteId/branches/:branchId/documents — create document
  const docCreate = routeMatch("/api/sites/:siteId/branches/:branchId/documents", pathname);
  if (docCreate && method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body) as { path?: string };
      const docPath = parsed.path ?? "";
      const id = `doc-${docs.size}`;
      const record: DocRecord = { id, path: docPath, snapshot: {} };
      docs.set(docPath, record);
      return json(res, 201, {
        document: {
          id,
          siteId: SITE_ID,
          path: docPath,
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    });
    return;
  }

  // POST /api/sites/:siteId/documents/:docId/versions — create version
  const versionCreate = routeMatch("/api/sites/:siteId/documents/:docId/versions", pathname);
  if (versionCreate && method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body) as { snapshot?: Record<string, unknown>; branchId?: string };
      const doc = Array.from(docs.values()).find((d) => d.id === versionCreate.docId);
      if (doc && parsed.snapshot) {
        doc.snapshot = parsed.snapshot;
      }
      return json(res, 201, {
        id: "ver-new",
        documentId: versionCreate.docId,
        branchId: parsed.branchId ?? BRANCH_ID,
        versionNumber: 2,
        snapshot: parsed.snapshot ?? {},
        crdtState: null,
        source: "api",
        createdById: "system",
        createdByType: "user",
        createdAt: new Date().toISOString(),
      });
    });
    return;
  }

  // DELETE /api/sites/:siteId/branches/:branchId/documents/:docId
  const docDelete = routeMatch("/api/sites/:siteId/branches/:branchId/documents/:docId", pathname);
  if (docDelete && method === "DELETE") {
    const doc = Array.from(docs.entries()).find(([, d]) => d.id === docDelete.docId);
    if (doc) docs.delete(doc[0]);
    return json(res, 200, { ok: true });
  }

  notFound(res);
}

const port = parseInt(process.env.MOCK_CSS_PORT ?? "4444", 10);
const server = createServer(handleRequest);
server.listen(port, () => {
  console.log(`Mock CSS server listening on http://localhost:${port}`);
});
