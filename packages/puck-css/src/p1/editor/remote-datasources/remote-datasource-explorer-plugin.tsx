"use client";

import type { Plugin } from "@puckeditor/core";
import { useMemo } from "react";

import type { RemoteDatasourceDefinition } from "../../../data/remote-datasources/remote-datasource-registry";
import type { RemoteDatasourceContext } from "../../../data/remote-datasources/loader";
import { isCanonicalTemplatePath } from "../../../data/route-templates";
import { JsonTree } from "../json-tree";
import {
  card,
  mono,
  muted,
  sectionLabel,
} from "../../../data/styles";
import { RemoteDatasourceManager } from "./remote-datasource-manager";
import { TemplatePreviewParamsToolbar } from "./template-preview-params-toolbar";

const pulseKeyframes = `@keyframes p1-ds-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}`;

function DatasourceSkeleton() {
  return (
    <>
      <style>{pulseKeyframes}</style>
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

function RemoteDatasourceExplorerPanel({
  snapshot,
  editorPath,
  routeTemplateKeys,
  savedPreviewParams,
  remoteDatasourceRegistry,
  loadingIds,
}: {
  snapshot: RemoteDatasourceContext;
  editorPath: string;
  routeTemplateKeys: string[];
  savedPreviewParams: Record<string, string>;
  remoteDatasourceRegistry: RemoteDatasourceDefinition[];
  loadingIds?: Set<string>;
}) {
  const registry = useMemo(() => remoteDatasourceRegistry, [remoteDatasourceRegistry]);

  return (
    <div
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontSize: 13,
        lineHeight: 1.45,
        maxHeight: "100%",
        overflow: "auto",
      }}
    >
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

      {registry.map((def, index) => {
        const isLoading = loadingIds?.has(def.id) ?? false;
        const live = snapshot[def.id] ?? {};
        const keys = Object.keys(live);
        const empty = keys.length === 0;

        return (
          <details
            key={def.id}
            open={index === 0}
            style={{ ...card, background: "var(--puck-color-grey-11, #f9fafb)" }}
          >
            <summary
              style={{
                cursor: "pointer",
                padding: "10px 12px",
                fontWeight: 600,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <span>{def.label}</span>
              <span
                style={{
                  ...mono,
                  fontSize: 12,
                  fontWeight: 400,
                  color: "var(--puck-color-azure-04, #2563eb)",
                }}
              >
                {def.id}
              </span>
            </summary>
            <div style={{ padding: "0 12px 12px" }}>
              <p style={{ margin: "0 0 8px", ...muted }}>{def.description}</p>
              <p style={{ margin: "0 0 12px", ...muted }}>
                <strong style={{ color: "inherit" }}>Loaded when:</strong>{" "}
                {def.resolution}
              </p>

              <details style={{ marginBottom: 12 }}>
                <summary style={{ ...sectionLabel, cursor: "pointer", marginBottom: 8 }}>
                  Documented fields
                </summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, ...muted }}>
                  {def.fields.map((f) => (
                    <li key={f.path} style={{ marginBottom: 6 }}>
                      <code style={mono}>{`${def.id}.${f.path}`}</code>
                      <span> — {f.description}</span>
                    </li>
                  ))}
                </ul>
              </details>

              <div>
                <div style={sectionLabel}>
                  This page (live) — <code style={mono}>{def.id}</code>
                </div>
                {isLoading ? (
                  <DatasourceSkeleton />
                ) : empty ? (
                  <p style={{ margin: "8px 0 0", ...muted }}>
                    No data loaded for <code style={mono}>{def.id}</code>. Use
                    query params that match your route template (e.g.{" "}
                    <code style={mono}>?id=1</code>), open a concrete
                    instance in the editor, or
                    {isCanonicalTemplatePath(editorPath, routeTemplateKeys) ? (
                      <> set preview values above.</>
                    ) : (
                      <>
                        {" "}
                        edit a collection template row to set preview params.
                      </>
                    )}
                  </p>
                ) : (
                  <JsonTree data={live} />
                )}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function createRemoteDatasourceExplorerPlugin(
  snapshot: RemoteDatasourceContext,
  options: {
    editorPath: string;
    routeTemplateKeys: string[];
    savedPreviewParams: Record<string, string>;
    remoteDatasourceRegistry: RemoteDatasourceDefinition[];
    loadingIds?: Set<string>;
  },
): Plugin {
  return {
    name: "datasource-explorer",
    label: "Data sources",
    render: () => (
      <RemoteDatasourceExplorerPanel
        snapshot={snapshot}
        editorPath={options.editorPath}
        routeTemplateKeys={options.routeTemplateKeys}
        savedPreviewParams={options.savedPreviewParams}
        remoteDatasourceRegistry={options.remoteDatasourceRegistry}
        loadingIds={options.loadingIds}
      />
    ),
  };
}
