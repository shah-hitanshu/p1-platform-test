"use client";

import type { Plugin } from "@puckeditor/core";

import { isCanonicalTemplatePath } from "../../../data/route-templates";
import { useLiveRemoteDatasources } from "../hooks/useLiveRemoteDatasources";
import {
  card,
  mono,
  muted,
  sectionLabel,
} from "../../../data/styles";
import { PanelShell } from "../../../editor/components/PanelShell.js";
import { RemoteDatasourceManager } from "./remote-datasource-manager";
import { TemplatePreviewParamsToolbar } from "./template-preview-params-toolbar";

const panelStyles = `
@keyframes p1-ds-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
[data-p1-ds] > summary::marker,
[data-p1-ds] > summary::-webkit-details-marker { display: none; }
`;

/** Render a datasource value for the compact preview without ever producing
 *  "[object Object]": scalars print directly, objects/arrays serialize to JSON. */
function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return Array.isArray(value) ? `[${value.length} items]` : "{…}";
  }
}

function DatasourceSkeleton() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
        {[100, 80, 90, 60, 70].map((width, i) => (
          <div
            key={i}
            style={{
              height: 12,
              width: `${width}%`,
              borderRadius: 4,
              background: "var(--puck-color-grey-09, #d1d5db)",
              animation: "p1-ds-pulse 1.5s ease-in-out infinite",
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    </>
  );
}

const dbIconSvg = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z" />
    <path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" />
    <path d="M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3" />
  </svg>
);

function RemoteDatasourceExplorerPanel({
  initialPath,
}: {
  initialPath: string;
}) {
  const {
    path: editorPath,
    registry,
    context: snapshot,
    loadingIds,
    routeTemplateKeys,
    savedPreviewParams,
  } = useLiveRemoteDatasources(initialPath);

  return (
    <PanelShell title="Data sources">
      <style>{panelStyles}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
      <p style={{ ...muted, margin: 0 }}>
        Data sources enable you to organize your connected artifacts and integrate them into your page.
      </p>
      <TemplatePreviewParamsToolbar
        editorPath={editorPath}
        routeTemplateKeys={routeTemplateKeys}
        savedPreviewParams={savedPreviewParams}
      />
      <RemoteDatasourceManager editorPath={editorPath} />

      <p style={{ ...muted, margin: 0 }}>
        Use <code style={mono}>{`{{ source.field }}`}</code> in text fields;
        after <code style={mono}>{`{{`}</code>, matching datasource paths are
        suggested automatically. Nested keys use dots, e.g.{" "}
        <code style={mono}>{`{{ source.nested.key }}`}</code>. You can also call
        allowlisted helpers, e.g.{" "}
        <code style={mono}>{`{{ toUpperCase(source.field) }}`}</code>,{" "}
        <code style={mono}>{`{{ replace(source.field, " ", "-") }}`}</code>, or{" "}
        <code style={mono}>{`{{ default(source.field, "fallback") }}`}</code>. Bare{" "}
        <code style={mono}>{`{{ source }}`}</code> does not print the object
        (only strings, numbers, and booleans resolve to text). For list
        datasources, use{" "}
        <code
          style={mono}
        >{`{{ my_list.markdownLinks "/path/{id}" }}`}</code>{" "}
        in a <strong>List</strong> block&apos;s items field — each line becomes a
        markdown link. For Puck{" "}
        <code style={mono}>array</code> fields, use{" "}
        <code style={mono}>{`{{ my_list.items }}`}</code> to map list rows
        directly, then reference per-item values like{" "}
        <code style={mono}>{`{{ item.name }}`}</code> and{" "}
        <code style={mono}>{`{{ item.id }}`}</code> in item templates.
      </p>

      {registry.length > 0 && (
        <div style={{ ...sectionLabel, padding: "4px 2px 6px" }}>Connected sources</div>
      )}

      {registry.map((def, index) => {
        const isLoading = loadingIds.has(def.id);
        const live: Record<string, unknown> = (snapshot[def.id] ?? {}) as Record<string, unknown>;
        const liveKeys = Object.keys(live);
        const empty = liveKeys.length === 0;
        const firstField = def.fields[0]?.path ?? liveKeys[0] ?? "field";

        return (
          <details
            key={def.id}
            open={index === 0}
            data-p1-ds=""
            style={{ ...card, background: "var(--puck-color-white, #fff)", borderRadius: 12, marginBottom: 8 }}
          >
            <summary style={{ cursor: "pointer", listStyle: "none", display: "block" }}>
              <div
                style={{
                  padding: "10px 12px",
                  fontWeight: 600,
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: "var(--puck-color-azure-11, #eff6ff)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--puck-color-azure-04, #2563eb)",
                    flexShrink: 0,
                  }}
                >
                  {dbIconSvg}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block" }}>{def.label}</span>
                  <span
                    style={{
                      ...mono,
                      display: "block",
                      fontSize: 11,
                      fontWeight: 400,
                      color: "var(--puck-color-grey-04, #6b7280)",
                    }}
                  >
                    {def.id}{!empty && ` · ${liveKeys.length} keys`}
                  </span>
                </div>
              </div>
            </summary>

            <div style={{ padding: "4px 12px 12px" }}>
              {/* Field chips */}
              {def.fields.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                  {def.fields.map((f) => (
                    <code
                      key={f.path}
                      title={f.description}
                      style={{
                        ...mono,
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--puck-color-azure-04, #2563eb)",
                        background: "var(--puck-color-azure-11, #eff6ff)",
                        border: "1px solid var(--puck-color-grey-09, #bfdbfe)",
                        borderRadius: 6,
                        padding: "2px 7px",
                        cursor: "default",
                      }}
                    >
                      {f.path}
                    </code>
                  ))}
                </div>
              )}

              {/* Live data preview */}
              {isLoading ? (
                <DatasourceSkeleton />
              ) : empty ? (
                <p style={{ margin: "0 0 10px", ...muted }}>
                  No data loaded. Open a concrete page instance or{" "}
                  {isCanonicalTemplatePath(editorPath, routeTemplateKeys) ? (
                    <>set preview values above.</>
                  ) : (
                    <>edit a collection template row to set preview params.</>
                  )}
                </p>
              ) : (
                <div
                  style={{
                    background: "var(--puck-color-grey-11, #f9fafb)",
                    border: "1px solid var(--puck-color-grey-09, #e5e7eb)",
                    borderRadius: 9,
                    padding: "6px 10px",
                    marginBottom: 10,
                  }}
                >
                  {liveKeys.slice(0, 3).map((key, i) => (
                    <div
                      key={key}
                      style={{
                        ...mono,
                        fontSize: 11.5,
                        color: "var(--pds-color-fg-default-secondary, #4a4a4a)",
                        padding: "4px 0",
                        borderTop: i > 0 ? "1px solid var(--puck-color-grey-10, #f0f0f0)" : "none",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <span style={{ ...muted, fontSize: 11 }}>{key}:</span>{" "}
                      {formatPreviewValue(live[key])}
                    </div>
                  ))}
                  {liveKeys.length > 3 && (
                    <div
                      style={{
                        ...muted,
                        fontSize: 11,
                        padding: "4px 0 0",
                        borderTop: "1px solid var(--puck-color-grey-10, #f0f0f0)",
                      }}
                    >
                      +{liveKeys.length - 3} more
                    </div>
                  )}
                </div>
              )}

              {/* Reference syntax */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...muted, fontSize: 11 }}>
                  Reference as{" "}
                  <code style={{ ...mono, fontWeight: 600, color: "var(--puck-color-azure-04, #2563eb)", fontSize: 11 }}>
                    {`{{ ${def.id}.${firstField} }}`}
                  </code>
                </span>
              </div>

              {/* Collapsible details for power users */}
              <details style={{ marginTop: 10 }}>
                <summary style={{ ...sectionLabel, cursor: "pointer", fontSize: 10 }}>
                  More info
                </summary>
                <p style={{ margin: "6px 0 4px", ...muted }}>{def.description}</p>
                <p style={{ margin: "0 0 6px", ...muted }}>
                  <strong style={{ color: "inherit" }}>Loads when:</strong> {def.resolution}
                </p>
                <ul style={{ margin: 0, paddingLeft: 16, ...muted }}>
                  {def.fields.map((f) => (
                    <li key={f.path} style={{ marginBottom: 4 }}>
                      <code style={mono}>{`${def.id}.${f.path}`}</code> — {f.description}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </details>
        );
      })}
      </div>
    </PanelShell>
  );
}

/**
 * Datasource state cannot be passed in by value: Puck holds the plugin array
 * from the first mount, so anything captured here is frozen before the fetches
 * that fill it settle. The panel reads it live via useLiveRemoteDatasources.
 */
export function createRemoteDatasourceExplorerPlugin(options: {
  editorPath: string;
}): Plugin {
  return {
    name: "datasource-explorer",
    label: "Data sources",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z" />
        <path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" />
        <path d="M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3" />
      </svg>
    ),
    render: () => <RemoteDatasourceExplorerPanel initialPath={options.editorPath} />,
  };
}
