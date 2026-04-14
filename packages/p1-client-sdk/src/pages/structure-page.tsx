import Link from "next/link";

import { flattenStructureRoutes, listRoutes, type RouteRow } from "../lib/page-store";
import { editorPathHref, publicPagePathHref } from "../lib/route-templates";

import { P1QueryProvider } from "../lib/query-provider";
import { AddOverrideForTemplate } from "./add-override-for-template";
import { CreatePageForm } from "./create-page-form";
import { CreateTemplateForm } from "./create-template-form";
import { DeleteStructureRowButton } from "./delete-row-button";

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

export default function StructurePage() {
  const routes = listRoutes();
  const flat = flattenStructureRoutes(routes);

  return (
    <P1QueryProvider>
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "24px 32px", maxWidth: 960 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>Site structure</h1>
        <p style={{ margin: 0, color: "#444", lineHeight: 1.5 }}>
          Routes backed by <code>database.json</code>. <strong>Static pages</strong> are full Puck
          documents. Keys with <strong>path parameters</strong> (e.g. <code>/starships/:id</code>,{" "}
          <code>/docs/:category/:slug</code>) are <strong>collection templates</strong>: the canonical
          layout for every matching URL. <strong>Overrides</strong> (diffs) and full <strong>instance</strong>{" "}
          documents nest under their template. Overrides use semantic ops (stable <code>props.id</code>). Use{" "}
          <strong>Add override</strong> on a collection template row to create an instance diff. Use{" "}
          <strong>Delete</strong> on a row to remove it from <code>database.json</code>; deleting a collection
          template also removes its overrides and full instances.
        </p>
      </header>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Add static page</h2>
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "#555" }}>
          New full page at a static path (e.g. <code>/contact-us</code>). For collection URLs, add an override from
          the template row in the table below.
        </p>
        <CreatePageForm />
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Add collection template</h2>
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "#555" }}>
          New reusable layout for dynamic routes (e.g. <code>/posts/:slug</code>, <code>/docs/:category/:id</code>).
        </p>
        <CreateTemplateForm />
      </section>

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
                    <Link href={editorPathHref(row.path)}>Create template</Link>
                  ) : (
                    <>
                      <Link href={publicPagePathHref(row.path)} style={{ marginRight: 12 }}>
                        View
                      </Link>
                      <Link href={editorPathHref(row.path)}>Edit</Link>
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
    </div>
    </P1QueryProvider>
  );
}

export const dynamic = "force-dynamic";
