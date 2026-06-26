"use client";

import { useState, useCallback } from "react";
import { useP1Auth } from "../../auth/P1AuthProvider";
import { primaryButton, dangerButton } from "../../data/styles";

export interface ConflictResolutionPanelProps {
  baseUrl: string;
  siteId: string;
  branchId: string;
  jobId: string;
  conflict: {
    id: string;
    documentId: string;
    documentPath: string;
    templateDelta: unknown;
    documentActions: unknown;
  };
  onResolved: () => void;
  onCancel: () => void;
}

type Resolution = "apply" | "skip" | "manual";

export function ConflictResolutionPanel({
  baseUrl,
  siteId,
  branchId,
  jobId,
  conflict,
  onResolved,
  onCancel,
}: ConflictResolutionPanelProps) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getToken } = useP1Auth();

  const handleResolve = useCallback(
    async (resolution: Resolution) => {
      setResolving(true);
      setError(null);
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(
          `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/migrations/${encodeURIComponent(jobId)}/conflicts/${encodeURIComponent(conflict.id)}/resolve`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ resolution }),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as Record<string, string>).error ?? `Resolve failed (${res.status})`);
        }
        onResolved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve conflict");
      } finally {
        setResolving(false);
      }
    },
    [baseUrl, siteId, branchId, jobId, conflict.id, getToken, onResolved],
  );

  const templateDelta = conflict.templateDelta as Array<Record<string, unknown>> | null;
  const documentActions = conflict.documentActions as Array<Record<string, unknown>> | null;

  return (
    <div
      style={{
        border: "1px solid #fca5a5",
        borderRadius: 6,
        padding: 16,
        background: "#fef2f2",
        marginTop: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          Resolve conflict: {conflict.documentPath}
        </h4>
        <button
          type="button"
          onClick={onCancel}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#666" }}
        >
          Cancel
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4 }}>Template changes</div>
          <pre
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
              overflow: "auto",
              maxHeight: 200,
              margin: 0,
            }}
          >
            {templateDelta ? JSON.stringify(templateDelta, null, 2) : "No structural changes"}
          </pre>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4 }}>Document customizations</div>
          <pre
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
              overflow: "auto",
              maxHeight: 200,
              margin: 0,
            }}
          >
            {documentActions ? JSON.stringify(documentActions, null, 2) : "No structural actions"}
          </pre>
        </div>
      </div>

      {error && <p style={{ fontSize: 13, color: "#c00", margin: "0 0 8px" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => handleResolve("apply")}
          disabled={resolving}
          style={{ ...primaryButton, padding: "6px 14px", fontSize: 13 }}
        >
          Apply template change
        </button>
        <button
          type="button"
          onClick={() => handleResolve("skip")}
          disabled={resolving}
          style={{
            ...primaryButton,
            padding: "6px 14px",
            fontSize: 13,
            background: "#f59e0b",
            borderColor: "#d97706",
          }}
        >
          Skip (keep document as-is)
        </button>
        <button
          type="button"
          onClick={() => handleResolve("manual")}
          disabled={resolving}
          style={{
            ...dangerButton,
            padding: "6px 14px",
            fontSize: 13,
          }}
        >
          Manual (edit later)
        </button>
      </div>
    </div>
  );
}
