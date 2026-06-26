"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useP1Auth } from "../../auth/P1AuthProvider";
import { primaryButton, dangerButton, mono } from "../../data/styles";
import { MigrationConflictQueue } from "./migration-conflict-queue";
import { MigrationPreviewPanel } from "./migration-preview-panel";

export interface MigrationStatusPanelProps {
  baseUrl: string;
  siteId: string;
  branchId: string;
}

interface TemplateItem {
  id: string;
  name: string;
  label: string;
  version: number;
}

interface MigrationJob {
  id: string;
  templateId: string;
  fromVersion: number;
  toVersion: number;
  status: "pending" | "in_progress" | "completed" | "completed_with_conflicts" | "failed";
  totalDocuments: number;
  processedDocuments: number;
  createdAt: string;
  completedAt: string | null;
}

interface MigrationConflict {
  id: string;
  documentId: string;
  documentPath: string;
  resolution: "apply" | "skip" | "manual" | null;
}

const POLL_INTERVAL_MS = 3000;

export function MigrationStatusPanel({
  baseUrl,
  siteId,
  branchId,
}: MigrationStatusPanelProps) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<MigrationJob | null>(null);
  const [conflicts, setConflicts] = useState<MigrationConflict[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { getToken } = useP1Auth();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }, [getToken]);

  const fetchTemplates = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates`,
        { method: "GET", headers },
      );
      if (res.ok) {
        const data = await res.json();
        setTemplates(
          ((data as { templates: TemplateItem[] }).templates ?? []).filter(
            (t) => t.version > 1,
          ),
        );
      }
    } catch {
      // Silent — templates section handles its own loading
    }
  }, [baseUrl, siteId, branchId, authHeaders]);

  const fetchConflicts = useCallback(async (jobId: string) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/migrations/${encodeURIComponent(jobId)}/conflicts`,
        { method: "GET", headers },
      );
      if (res.ok) {
        const data = (await res.json()) as { conflicts: MigrationConflict[] };
        setConflicts(data.conflicts ?? []);
      }
    } catch {
      // Non-critical — conflict queue will retry on its own
    }
  }, [baseUrl, siteId, branchId, authHeaders]);

  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/migrations/${encodeURIComponent(jobId)}`,
        { method: "GET", headers },
      );
      if (!res.ok) return;
      const job = (await res.json()) as MigrationJob;
      setActiveJob(job);

      if (job.status === "completed" || job.status === "completed_with_conflicts" || job.status === "failed") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        if (job.status === "completed_with_conflicts") {
          await fetchConflicts(jobId);
        }
      }
    } catch {
      // Transient — next poll will retry
    }
  }, [baseUrl, siteId, branchId, authHeaders, fetchConflicts]);

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { pollJobStatus(jobId); }, POLL_INTERVAL_MS);
  }, [pollJobStatus]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handlePreview = useCallback(() => {
    if (!selectedTemplate) return;
    setShowPreview(true);
    setError(null);
  }, [selectedTemplate]);

  const handleMigrate = useCallback(async () => {
    if (!selectedTemplate) return;
    setMigrating(true);
    setError(null);
    setMessage(null);
    setConflicts([]);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates/${encodeURIComponent(selectedTemplate.id)}/migrate`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            fromVersion: 1,
            toVersion: selectedTemplate.version,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Migration failed (${res.status})`);
      }
      const data = (await res.json()) as { job: MigrationJob };
      setActiveJob(data.job);
      setMessage(`Migration started: ${data.job.totalDocuments} documents to process`);
      if (data.job.status === "pending" || data.job.status === "in_progress") {
        startPolling(data.job.id);
      } else if (data.job.status === "completed_with_conflicts") {
        await fetchConflicts(data.job.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start migration");
    } finally {
      setMigrating(false);
    }
  }, [selectedTemplate, baseUrl, siteId, branchId, authHeaders, startPolling, fetchConflicts]);

  const handleRollback = useCallback(async () => {
    if (!activeJob || !selectedTemplate) return;
    if (!window.confirm("Roll back this migration? Documents will revert to their pre-migration state.")) return;
    setRollingBack(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates/${encodeURIComponent(selectedTemplate.id)}/rollback`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ jobId: activeJob.id }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Rollback failed (${res.status})`);
      }
      const result = (await res.json()) as { rolledBackDocuments: number; failedDocuments?: number };
      if (result.failedDocuments && result.failedDocuments > 0) {
        setMessage(`Partial rollback: ${result.rolledBackDocuments} reverted, ${result.failedDocuments} failed`);
      } else {
        setMessage(`Rollback complete: ${result.rolledBackDocuments} documents reverted`);
        setActiveJob(null);
        setConflicts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setRollingBack(false);
    }
  }, [activeJob, selectedTemplate, baseUrl, siteId, branchId, authHeaders]);

  if (templates.length === 0) {
    return (
      <p style={{ fontSize: 14, color: "#888" }}>
        No templates with multiple versions. Edit a template to create a new version, then migrate documents here.
      </p>
    );
  }

  const showRollback = activeJob && (activeJob.status === "completed" || activeJob.status === "completed_with_conflicts");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select
          value={selectedTemplateId ?? ""}
          onChange={(e) => {
            setSelectedTemplateId(e.target.value || null);
            setActiveJob(null);
            setConflicts([]);
            setShowPreview(false);
            setError(null);
            setMessage(null);
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          }}
          style={{
            padding: "8px 10px",
            fontSize: 14,
            border: "1px solid #ccc",
            borderRadius: 4,
          }}
        >
          <option value="">Select template...</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} (v{t.version})
            </option>
          ))}
        </select>

        {selectedTemplate && !activeJob && (
          <>
            <button
              type="button"
              onClick={handlePreview}
              style={{ ...primaryButton, padding: "8px 14px", fontSize: 14, background: "#6366f1" }}
            >
              Preview migration
            </button>
            <button
              type="button"
              onClick={handleMigrate}
              disabled={migrating}
              style={{ ...primaryButton, padding: "8px 14px", fontSize: 14, cursor: migrating ? "wait" : undefined }}
            >
              {migrating ? "Starting..." : "Trigger migration"}
            </button>
          </>
        )}

        {showRollback && (
          <button
            type="button"
            onClick={handleRollback}
            disabled={rollingBack}
            style={{ ...dangerButton, padding: "8px 14px", fontSize: 14, cursor: rollingBack ? "wait" : undefined }}
          >
            {rollingBack ? "Rolling back..." : "Rollback"}
          </button>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 13, color: "#c00", margin: 0 }}>{error}</p>
      )}
      {message && (
        <p style={{ fontSize: 13, color: "#0a0", margin: 0 }}>{message}</p>
      )}

      {activeJob && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            padding: 12,
            fontSize: 14,
            background: "#f9fafb",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Migration job: <span style={mono}>{activeJob.id.slice(0, 8)}</span>
          </div>
          <div>Status: <strong>{activeJob.status.replace(/_/g, " ")}</strong></div>
          <div>
            Progress: {activeJob.processedDocuments} / {activeJob.totalDocuments} documents
          </div>
          {conflicts.length > 0 && (
            <div style={{ color: "#b45309" }}>
              Conflicts: {conflicts.length} documents need review
            </div>
          )}
        </div>
      )}

      {activeJob && conflicts.length > 0 && (
        <MigrationConflictQueue
          baseUrl={baseUrl}
          siteId={siteId}
          branchId={branchId}
          jobId={activeJob.id}
        />
      )}

      {showPreview && selectedTemplate && !activeJob && (
        <MigrationPreviewPanel
          baseUrl={baseUrl}
          siteId={siteId}
          branchId={branchId}
          templateId={selectedTemplate.id}
          fromVersion={1}
          toVersion={selectedTemplate.version}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
