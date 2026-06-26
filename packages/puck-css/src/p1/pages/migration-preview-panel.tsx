"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useP1Auth } from "../../auth/P1AuthProvider";
import { mono, primaryButton } from "../../data/styles";

export interface MigrationPreviewPanelProps {
  baseUrl: string;
  siteId: string;
  branchId: string;
  templateId: string;
  fromVersion: number;
  toVersion: number;
  onClose: () => void;
  onMigrationComplete?: () => void;
}

interface PreviewDocument {
  documentId: string;
  path: string;
  currentTemplateVersion?: number | null;
  hasConflict: boolean;
  conflictDetails?: {
    templateDelta: unknown;
    documentActions: unknown;
  };
}

interface PreviewResult {
  templateId: string;
  fromVersion: number;
  toVersion: number;
  affectedDocuments: number;
  cleanDocuments: number;
  estimatedConflicts: number;
  documents?: PreviewDocument[];
}

interface MigrationResult {
  job: {
    id: string;
    status: string;
    totalDocuments: number;
    processedDocuments: number;
  };
  status?: string;
  processedDocuments?: number;
  conflictedDocuments?: number;
}

export function MigrationPreviewPanel({
  baseUrl,
  siteId,
  branchId,
  templateId,
  fromVersion,
  toVersion,
  onClose,
  onMigrationComplete,
}: MigrationPreviewPanelProps) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<string | null>(null);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const { getToken } = useP1Auth();
  const abortRef = useRef(false);

  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates/${encodeURIComponent(templateId)}/migrate/preview?detail=true`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ fromVersion, toVersion }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Preview failed (${res.status})`);
      }
      setPreview((await res.json()) as PreviewResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, siteId, branchId, templateId, fromVersion, toVersion, getToken]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const handleMigrate = useCallback(async () => {
    if (!preview || !window.confirm(
      `Migrate ${String(preview.affectedDocuments)} document${preview.affectedDocuments !== 1 ? "s" : ""} to v${String(toVersion)}? A checkpoint will be created for rollback.`
    )) return;
    setMigrating(true);
    setMigrationProgress("Starting migration...");
    setError(null);
    abortRef.current = false;
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates/${encodeURIComponent(templateId)}/migrate`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ fromVersion, toVersion }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Migration failed (${res.status})`);
      }
      const result = (await res.json()) as MigrationResult;

      if (res.status === 202) {
        setMigrationProgress(`Migration queued — processing ${String(preview.affectedDocuments)} documents...`);
        const pollInterval = 2000;
        const maxPolls = 60;
        for (let i = 0; i < maxPolls; i++) {
          await new Promise((r) => setTimeout(r, pollInterval));
          if (abortRef.current) return;
          const freshToken = await getToken();
          const pollHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (freshToken) pollHeaders["Authorization"] = `Bearer ${freshToken}`;
          const statusRes = await fetch(
            `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates/${encodeURIComponent(templateId)}/migration-status`,
            { method: "GET", headers: pollHeaders },
          );
          if (abortRef.current) return;
          if (statusRes.ok) {
            const status = (await statusRes.json()) as { migrationAvailable: boolean; staleDocumentCount: number };
            const done = preview.affectedDocuments - status.staleDocumentCount;
            if (!status.migrationAvailable) {
              setMigrationProgress(null);
              setMigrationResult({
                ...result,
                processedDocuments: preview.affectedDocuments,
                conflictedDocuments: 0,
              });
              onMigrationComplete?.();
              return;
            }
            setMigrationProgress(
              `Processing... ${String(done)} of ${String(preview.affectedDocuments)} documents migrated`
            );
          }
        }
        if (abortRef.current) return;
        setMigrationProgress(null);
        setError("Migration is still running in the background. Refresh the page to check status.");
        onMigrationComplete?.();
      } else {
        setMigrationProgress(null);
        setMigrationResult(result);
        onMigrationComplete?.();
      }
    } catch (err) {
      setMigrationProgress(null);
      setError(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrating(false);
    }
  }, [preview, baseUrl, siteId, branchId, templateId, fromVersion, toVersion, getToken, onMigrationComplete]);

  return (
    <div
      style={{
        border: "1px solid #ddd6fe",
        borderRadius: 6,
        padding: 16,
        background: "#faf5ff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Migration preview (dry-run)
        </h3>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#666" }}
        >
          Close
        </button>
      </div>

      {loading && <p style={{ fontSize: 14, color: "#888" }}>Analyzing documents...</p>}

      {error && <p style={{ fontSize: 14, color: "#c00" }}>{error}</p>}

      {preview && (
        <div style={{ fontSize: 14 }}>
          <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{preview.affectedDocuments}</div>
              <div style={{ color: "#666" }}>Affected documents</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#16a34a" }}>{preview.cleanDocuments}</div>
              <div style={{ color: "#666" }}>Will migrate cleanly</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: preview.estimatedConflicts > 0 ? "#b45309" : "#16a34a" }}>
                {preview.estimatedConflicts}
              </div>
              <div style={{ color: "#666" }}>Conflicts</div>
            </div>
          </div>

          {preview.documents && preview.documents.some((d) => d.hasConflict) && (
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 6px" }}>Conflicting documents:</h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Path</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Template version</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.documents.filter((d) => d.hasConflict).map((d) => (
                    <tr key={d.documentId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "4px 8px", ...mono }}>{d.path}</td>
                      <td style={{ padding: "4px 8px" }}>v{d.currentTemplateVersion ?? 0} → v{preview.toVersion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.documents && preview.documents.some((d) => !d.hasConflict) && (
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 6px" }}>Clean documents:</h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Path</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Template version</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.documents.filter((d) => !d.hasConflict).map((d) => (
                    <tr key={d.documentId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "4px 8px", ...mono }}>{d.path}</td>
                      <td style={{ padding: "4px 8px" }}>v{d.currentTemplateVersion ?? 0} → v{preview.toVersion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!migrationResult && (
            <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
              {preview.estimatedConflicts === 0 && (
                <span style={{ color: "#16a34a", fontSize: 13 }}>
                  All documents can migrate cleanly.
                </span>
              )}
              <button
                type="button"
                onClick={handleMigrate}
                disabled={migrating || preview.affectedDocuments === 0}
                style={{
                  ...primaryButton,
                  padding: "8px 16px",
                  fontSize: 14,
                  cursor: migrating ? "wait" : undefined,
                  opacity: preview.affectedDocuments === 0 ? 0.5 : 1,
                }}
              >
                {migrating ? "Migrating..." : `Run migration (${preview.affectedDocuments} document${preview.affectedDocuments !== 1 ? "s" : ""})`}
              </button>
            </div>
          )}

          {migrationProgress && (
            <div style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 6,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              fontSize: 14,
              color: "#1e40af",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              {migrationProgress}
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {migrationResult && (() => {
            const processed = migrationResult.processedDocuments ?? migrationResult.job.processedDocuments ?? 0;
            const conflicts = migrationResult.conflictedDocuments ?? 0;
            return (
              <div style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 6,
                background: conflicts > 0 ? "#fef3c7" : "#dcfce7",
                border: `1px solid ${conflicts > 0 ? "#fbbf24" : "#86efac"}`,
                fontSize: 14,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Migration complete
                </div>
                <div>{processed} document{processed !== 1 ? "s" : ""} processed</div>
                {conflicts > 0 && (
                  <div style={{ color: "#b45309" }}>
                    {conflicts} conflict{conflicts !== 1 ? "s" : ""} need review
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
