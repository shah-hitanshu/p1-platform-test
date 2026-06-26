"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { useP1Auth } from "../../auth/P1AuthProvider";
import { dangerButton, mono } from "../../data/styles";
import { MigrationPreviewPanel } from "./migration-preview-panel";

export interface ContentTypeTemplateListProps {
  baseUrl: string;
  siteId: string;
  branchId: string;
}

interface TemplateItem {
  id: string;
  name: string;
  label: string;
  description?: string;
  defaultUrlPattern?: string;
  deprecated?: boolean;
  version?: number;
  components?: Array<{ type: string; pinned: boolean }>;
  updatedAt?: string;
}

interface MigrationStatusResult {
  templateId: string;
  currentVersion: number;
  staleDocumentCount: number;
  oldestDocumentVersion: number | null;
  migrationAvailable: boolean;
}

export function ContentTypeTemplateList({
  baseUrl,
  siteId,
  branchId,
}: ContentTypeTemplateListProps) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [migrationStatus, setMigrationStatus] = useState<Map<string, MigrationStatusResult>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { getToken } = useP1Auth();

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates`,
        { method: "GET", headers }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed (${res.status})`);
      }

      const data = await res.json();
      const items = (data as { templates: TemplateItem[] }).templates ?? [];
      setTemplates(items);

      // Fetch migration status for each template
      const statusMap = new Map<string, MigrationStatusResult>();
      await Promise.all(
        items.map(async (t) => {
          try {
            const statusRes = await fetch(
              `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates/${encodeURIComponent(t.id)}/migration-status`,
              { method: "GET", headers }
            );
            if (statusRes.ok) {
              const status = (await statusRes.json()) as MigrationStatusResult;
              statusMap.set(t.id, status);
            }
          } catch {
            // Silent — migration status is informational
          }
        })
      );
      setMigrationStatus(statusMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, siteId, branchId, getToken]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Listen for template creation events from the create form
  useEffect(() => {
    const handler = () => { fetchTemplates(); };
    window.addEventListener("p1:template-created", handler);
    return () => window.removeEventListener("p1:template-created", handler);
  }, [fetchTemplates]);

  // Refresh when the templates tab is activated
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail?.tabId === "templates") {
        fetchTemplates();
      }
    };
    window.addEventListener("p1:tab-activated", handler);
    return () => window.removeEventListener("p1:tab-activated", handler);
  }, [fetchTemplates]);

  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (template: TemplateItem) => {
      if (!window.confirm(`Delete template "${template.label || template.name}"? Documents using it will not be affected.`)) return;
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(
          `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates/${encodeURIComponent(template.id)}`,
          { method: "DELETE", headers }
        );

        if (!res.ok && res.status !== 204) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as Record<string, string>).error ?? `Failed (${res.status})`);
        }

        await fetchTemplates();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete template");
      }
    },
    [baseUrl, siteId, branchId, getToken, fetchTemplates]
  );

  if (loading) {
    return <p style={{ fontSize: 14, color: "#888" }}>Loading templates...</p>;
  }

  if (error) {
    return (
      <p role="alert" style={{ fontSize: 14, color: "#c00" }}>
        {error}{" "}
        <button
          type="button"
          onClick={() => fetchTemplates()}
          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14 }}
        >
          Retry
        </button>
      </p>
    );
  }

  if (templates.length === 0) {
    return <p style={{ fontSize: 14, color: "#888" }}>No content type templates yet.</p>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 12 }}>
      <thead>
        <tr style={{ borderBottom: "2px solid #ccc", textAlign: "left" }}>
          <th style={{ padding: "8px 8px" }}>Label</th>
          <th style={{ padding: "8px 8px" }}>Name</th>
          <th style={{ padding: "8px 8px" }}>URL pattern</th>
          <th style={{ padding: "8px 8px" }}>Components</th>
          <th style={{ padding: "8px 8px" }}>Version</th>
          <th style={{ padding: "8px 8px" }}>Migration</th>
          <th style={{ padding: "8px 8px" }}>Last updated</th>
          <th style={{ padding: "8px 8px" }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {templates.map((t) => {
          const status = migrationStatus.get(t.id);
          const showingPreview = previewTemplateId === t.id;
          return (
            <Fragment key={t.id}>
              <tr style={{ borderBottom: showingPreview ? "none" : "1px solid #e8e8e8" }}>
                <td style={{ padding: "8px" }}>
                  {t.label || t.name}
                  {t.deprecated && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: "#b45309", background: "#fef3c7", padding: "1px 6px", borderRadius: 3 }}>
                      deprecated
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px", ...mono }}>{t.name}</td>
                <td style={{ padding: "8px", ...mono }}>{t.defaultUrlPattern ?? "—"}</td>
                <td style={{ padding: "8px" }}>{(t as unknown as { content?: unknown[] }).content?.length ?? t.components?.length ?? 0}</td>
                <td style={{ padding: "8px" }}>v{t.version ?? 1}</td>
                <td style={{ padding: "8px", fontSize: 12 }}>
                  {status?.migrationAvailable ? (
                    <span>
                      <span style={{ color: "#b45309", background: "#fef3c7", padding: "2px 8px", borderRadius: 3, fontWeight: 500 }}>
                        Migration available
                      </span>
                      <span style={{ color: "#666", marginLeft: 4 }}>
                        — {status.staleDocumentCount} document{status.staleDocumentCount !== 1 ? "s" : ""}
                      </span>
                      {" "}
                      <button
                        type="button"
                        onClick={() => setPreviewTemplateId(showingPreview ? null : t.id)}
                        style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
                      >
                        {showingPreview ? "Hide preview" : "Preview"}
                      </button>
                    </span>
                  ) : (
                    <span style={{ color: "#16a34a" }}>Up to date</span>
                  )}
                </td>
                <td style={{ padding: "8px", fontSize: 12, color: "#666" }}>
                  {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "8px" }}>
                  <a
                    href={`/p1/_registry/templates/${t.name}`}
                    style={{ marginRight: 12 }}
                  >
                    Edit
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDelete(t)}
                    style={{ ...dangerButton, fontSize: 12 }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
              {showingPreview && status && (
                <tr style={{ borderBottom: "1px solid #e8e8e8" }}>
                  <td colSpan={8} style={{ padding: "0 8px 12px" }}>
                    <MigrationPreviewPanel
                      baseUrl={baseUrl}
                      siteId={siteId}
                      branchId={branchId}
                      templateId={t.id}
                      fromVersion={status.oldestDocumentVersion ?? 0}
                      toVersion={status.currentVersion}
                      onClose={() => setPreviewTemplateId(null)}
                      onMigrationComplete={() => {
                        fetchTemplates();
                      }}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
