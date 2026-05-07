"use client";

import type { Config, Data } from "@puckeditor/core";
import { Render } from "@puckeditor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  encodePagesBlocksTemplate,
  flattenComponents,
  listConnectablePropKeys,
} from "../../../data/cross-reference";
import type { RouteKind, RouteRow } from "../../../data/page-store";
import { stripTrailingSlash } from "../../../data/paths";

import { buildConnectPreviewConfig, ConnectPreviewHitStyles } from "./connect-preview-config";
import { backdrop, ghostButton, modalPanel, mono, muted, secondaryButton } from "../../../data/styles";
import { useLoadPageData } from "../hooks";

function normalizeRoutePath(p: string): string {
  return stripTrailingSlash(p);
}

function kindLabel(kind: RouteKind): string {
  switch (kind) {
    case "template":
      return "Collection template";
    case "override":
      return "Collection override";
    case "instance-full":
      return "Collection instance";
    default:
      return "Static page";
  }
}

type Step = "pages" | "props";

export function ConnectFieldModal({
  open,
  onClose,
  onConfirm,
  routes,
  config,
  editorPath,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (template: string) => void;
  routes: RouteRow[];
  config: Config;
  editorPath: string;
}) {
  const [step, setStep] = useState<Step>("pages");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pageData, setPageData] = useState<Data | null>(null);
  const loadPageMutation = useLoadPageData();
  const loadPageMutationRef = useRef(loadPageMutation);
  loadPageMutationRef.current = loadPageMutation;
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [selectedComponentType, setSelectedComponentType] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("pages");
    setSelectedPath(null);
    setPageData(null);
    loadPageMutationRef.current.reset();
    setSelectedComponentId(null);
    setSelectedComponentType(null);
  }, []);

  useEffect(() => {
    reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  const loadPage = (path: string) => {
    setSelectedPath(path);
    loadPageMutation.mutate(path, {
      onSuccess: (data) => {
        setPageData(data);
        setStep("props");
      },
      onError: () => {
        setPageData(null);
      },
    });
  };

  const onSelectFromPreview = useCallback((id: string, type: string) => {
    setSelectedComponentId(id);
    setSelectedComponentType(type);
  }, []);

  const previewConfig = useMemo(
    () => buildConnectPreviewConfig(config, selectedComponentId, onSelectFromPreview),
    [config, selectedComponentId, onSelectFromPreview]
  );

  if (!open) return null;

  const flat = pageData ? flattenComponents(pageData, config) : [];
  const propKeys =
    selectedComponentType != null ? listConnectablePropKeys(config, selectedComponentType) : [];

  const editorNorm = normalizeRoutePath(editorPath);

  return (
    <div
      style={backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-field-title"
      onClick={onClose}
    >
      <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
        <header
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--puck-color-grey-09, #e5e7eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <h2 id="connect-field-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            Connect field
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ ...ghostButton, fontSize: 14 }}
          >
            Close
          </button>
        </header>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {step === "pages" && (
            <>
              <p style={{ ...muted, margin: "0 0 12px" }}>
                Choose a page (same routes as{" "}
                <a href="/p1/structure" target="_blank" rel="noreferrer">
                  Structure
                </a>
                ). Then pick a component and prop.
              </p>
              <div style={{ overflow: "auto", maxHeight: "min(52vh, 420px)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ padding: "8px 6px" }}>Path</th>
                      <th style={{ padding: "8px 6px" }}>Kind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((row) => (
                      <tr key={row.path} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 6px", ...mono, fontSize: 12 }}>
                          <button
                            type="button"
                            onClick={() => loadPage(row.path)}
                            disabled={loadPageMutation.isPending}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              cursor: loadPageMutation.isPending ? "wait" : "pointer",
                              color: "var(--puck-color-azure-04, #2563eb)",
                              textAlign: "left",
                            }}
                          >
                            {row.path}
                          </button>
                          {normalizeRoutePath(row.path) === editorNorm ? (
                            <span style={{ ...muted, marginLeft: 8 }}>(editing)</span>
                          ) : null}
                        </td>
                        <td style={{ padding: "8px 6px", ...muted }}>{kindLabel(row.kind)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {loadPageMutation.error ? <p style={{ color: "#b91c1c", marginTop: 12 }}>{loadPageMutation.error.message}</p> : null}
            </>
          )}

          {step === "props" && pageData && selectedPath && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setStep("pages");
                    setPageData(null);
                    setSelectedPath(null);
                    setSelectedComponentId(null);
                    setSelectedComponentType(null);
                    loadPageMutation.reset();
                  }}
                  style={secondaryButton}
                >
                  ← Pages
                </button>
                <span style={{ ...mono, fontSize: 12 }}>{selectedPath}</span>
              </div>

              <p style={{ ...muted, margin: "0 0 8px" }}>
                Click a block in the preview to select it, or pick from the list below.
              </p>
              <div
                style={{
                  border: "1px solid var(--puck-color-grey-09, #e5e7eb)",
                  borderRadius: 8,
                  overflow: "auto",
                  maxHeight: 240,
                  marginBottom: 16,
                  background: "#fafafa",
                }}
              >
                <ConnectPreviewHitStyles />
                <Render config={previewConfig} data={pageData} />
              </div>

              <div style={{ marginBottom: 10, fontWeight: 600, fontSize: 13 }}>Component</div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px", maxHeight: 160, overflow: "auto" }}>
                {flat.map((c) => (
                  <li key={`${c.type}-${c.id}`} style={{ marginBottom: 4 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedComponentId(c.id);
                        setSelectedComponentType(c.type);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 6,
                        border:
                          selectedComponentId === c.id
                            ? "1px solid var(--puck-color-azure-04, #2563eb)"
                            : "1px solid #e5e7eb",
                        background: selectedComponentId === c.id ? "#eff6ff" : "#fff",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>

              {selectedComponentType && (
                <>
                  <div style={{ marginBottom: 10, fontWeight: 600, fontSize: 13 }}>Prop to reference</div>
                  {propKeys.length === 0 ? (
                    <p style={muted}>No simple connectable fields on this component.</p>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {propKeys.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            if (!selectedComponentId) return;
                            const template = encodePagesBlocksTemplate(
                              normalizeRoutePath(selectedPath),
                              selectedComponentId,
                              k
                            );
                            onConfirm(template);
                            onClose();
                          }}
                          style={{ ...secondaryButton, ...mono, fontSize: 12 }}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
