import { flattenStructureRoutes, listRoutes, type RouteRow } from "../../data/page-store";
import { editorPathHref, publicPagePathHref } from "../../data/route-templates";

import { P1QueryProvider } from "../../data/query-provider";
import { AddOverrideForTemplate } from "./add-override-for-template";
import { CreatePageForm } from "./create-page-form";
import { CreateTemplateForm } from "./create-template-form";
import { CreateContentTypeForm } from "./create-content-type-form";
import { ContentTypeTemplateList } from "./content-type-template-list";
// MigrationStatusPanel replaced by per-row status in ContentTypeTemplateList
import { DeleteStructureRowButton } from "./delete-row-button";
import { StructureTabs } from "./structure-tabs";

function kindLabel(row: RouteRow, meta: { depth: number; synthetic?: boolean }): string {
  if (meta.synthetic) {
    return "Template (missing — add in editor)";
  }
  switch (row.kind) {
    case "template":
      return "Collection template";
    case "override":
      return meta.depth > 0 ? "Override (diff)" : "Collection override (diff)";
    case "instance-full":
      return meta.depth > 0 ? "Instance (full JSON)" : "Collection instance (full JSON)";
    default:
      return "Static page";
  }
}

async function fetchTemplateNames(baseUrl: string, siteId: string, branchId: string): Promise<Map<string, string>> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = process.env.CSS_API_KEY;
    if (apiKey) headers['X-API-Key'] = apiKey;
    const res = await fetch(`${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates`, {
      headers,
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as { templates: Array<{ id: string; name: string; label?: string }> };
    const map = new Map<string, string>();
    for (const t of data.templates ?? []) {
      map.set(t.id, t.label || t.name);
    }
    return map;
  } catch {
    return new Map();
  }
}

const card = {
  flex: "1 1 280px",
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  padding: "16px 18px",
  background: "#fafafa",
} as const;

const cardTitle = {
  fontSize: 15,
  fontWeight: 600 as const,
  margin: "0 0 4px",
};

const cardDesc = {
  margin: "0 0 12px",
  fontSize: 13,
  color: "#555",
  lineHeight: 1.4,
};

export default async function StructurePage() {
  const routes = await listRoutes();
  const flat = flattenStructureRoutes(routes);

  const cssBaseUrl = process.env.NEXT_PUBLIC_CSS_BASE_URL;
  const cssSiteId = process.env.NEXT_PUBLIC_CSS_SITE_ID;
  const cssBranchId = process.env.NEXT_PUBLIC_CSS_BRANCH_ID;

  const templateNames = cssBaseUrl && cssSiteId
    ? await fetchTemplateNames(cssBaseUrl, cssSiteId, cssBranchId ?? "main")
    : new Map<string, string>();

  const routesContent = (
    <>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #ccc", textAlign: "left" }}>
            <th style={{ padding: "10px 8px" }}>Route</th>
            <th style={{ padding: "10px 8px" }}>Type</th>
            <th style={{ padding: "10px 8px" }}>Content Type</th>
            <th style={{ padding: "10px 8px" }}>Base</th>
            <th style={{ padding: "10px 8px" }}>Ops</th>
            <th style={{ padding: "10px 8px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {flat.map((entry, i) => {
            const { row, depth, synthetic } = entry;
            const pad = 10 + depth * 22;
            return (
              <tr
                key={`${row.path}-${depth}-${i}`}
                style={{
                  borderBottom: "1px solid #e8e8e8",
                  background: depth > 0 ? "#fafafa" : undefined,
                }}
              >
                <td
                  style={{
                    padding: "10px 8px",
                    paddingLeft: pad,
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {depth > 0 && (
                    <span style={{ color: "#888", marginRight: 6 }} aria-hidden>
                      └
                    </span>
                  )}
                  {row.path}
                </td>
                <td style={{ padding: "10px 8px" }}>{kindLabel(row, { depth, synthetic })}</td>
                <td style={{ padding: "10px 8px", fontSize: 12, color: "#666" }}>
                  {row.contentTypeTemplateId
                    ? (templateNames.get(row.contentTypeTemplateId) ?? row.contentTypeTemplateId)
                    : "—"}
                </td>
                <td style={{ padding: "10px 8px", fontFamily: "ui-monospace, monospace" }}>
                  {row.basePath ?? "—"}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  {row.kind === "override"
                    ? `${row.patchOperations}`
                    : "—"}
                </td>
                <td style={{ padding: "10px 8px", verticalAlign: "top" }}>
                  {synthetic ? (
                    <a href={editorPathHref(row.path)}>Create template</a>
                  ) : (
                    <>
                      <a href={publicPagePathHref(row.path)} style={{ marginRight: 12 }}>
                        View
                      </a>
                      <a href={editorPathHref(row.path)}>Edit</a>
                      {row.kind === "template" ? <AddOverrideForTemplate templatePath={row.path} /> : null}
                      <DeleteStructureRowButton path={row.path} kind={row.kind} />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {routes.length === 0 && (
        <p style={{ color: "#666" }}>No routes in database yet.</p>
      )}
    </>
  );

  const templatesContent = cssBaseUrl && cssSiteId ? (
    <ContentTypeTemplateList
      baseUrl={cssBaseUrl}
      siteId={cssSiteId}
      branchId={cssBranchId ?? "main"}
    />
  ) : (
    <p style={{ color: "#666" }}>Configure CSS environment variables to manage templates.</p>
  );

  return (
    <P1QueryProvider>
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "24px 32px", maxWidth: 960 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>Site structure</h1>
      </header>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Create new</h2>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={card}>
            <h3 style={cardTitle}>Static page</h3>
            <p style={cardDesc}>
              Full page at a fixed path (e.g. <code>/contact-us</code>).
            </p>
            <CreatePageForm
              baseUrl={cssBaseUrl}
              siteId={cssSiteId}
              branchId={cssBranchId ?? "main"}
            />
          </div>

          <div style={card}>
            <h3 style={cardTitle}>Dynamic page</h3>
            <p style={cardDesc}>
              Reusable layout for dynamic routes (e.g. <code>/posts/:slug</code>).
            </p>
            <CreateTemplateForm
              baseUrl={cssBaseUrl}
              siteId={cssSiteId}
              branchId={cssBranchId ?? "main"}
            />
          </div>

          {cssBaseUrl && cssSiteId && (
            <div style={card}>
              <h3 style={cardTitle}>Content type template</h3>
              <p style={cardDesc}>
                Component skeleton with pinned regions and role-based permissions.
              </p>
              <CreateContentTypeForm
                baseUrl={cssBaseUrl}
                siteId={cssSiteId}
                branchId={cssBranchId ?? "main"}
              />
            </div>
          )}
        </div>
      </section>

      <StructureTabs
        tabs={[
          { id: "routes", label: "Routes", content: routesContent },
          { id: "templates", label: "Content Type Templates", content: templatesContent },
        ]}
      />
    </div>
    </P1QueryProvider>
  );
}
