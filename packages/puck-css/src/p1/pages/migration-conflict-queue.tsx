"use client";

import { useState, useEffect, useCallback } from "react";
import { useP1Auth } from "../../auth/P1AuthProvider";
import { primaryButton, mono } from "../../data/styles";
import { ConflictResolutionPanel } from "./conflict-resolution-panel";

export interface MigrationConflictQueueProps {
  baseUrl: string;
  siteId: string;
  branchId: string;
  jobId: string;
}

interface ConflictItem {
  id: string;
  documentId: string;
  documentPath: string;
  templateDelta: unknown;
  documentActions: unknown;
  resolution: "apply" | "skip" | "manual" | null;
  resolvedAt: string | null;
}

export function MigrationConflictQueue({
  baseUrl,
  siteId,
  branchId,
  jobId,
}: MigrationConflictQueueProps) {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);
  const { getToken } = useP1Auth();

  const fetchConflicts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(
        `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/migrations/${encodeURIComponent(jobId)}/conflicts`,
        { method: "GET", headers },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      setConflicts((data as { conflicts: ConflictItem[] }).conflicts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conflicts");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, siteId, branchId, jobId, getToken]);

  useEffect(() => {
    fetchConflicts();
  }, [fetchConflicts]);

  const handleResolved = useCallback(() => {
    setSelectedConflictId(null);
    fetchConflicts();
  }, [fetchConflicts]);

  const selectedConflict = conflicts.find((c) => c.id === selectedConflictId);
  const unresolvedCount = conflicts.filter((c) => c.resolution === null).length;

  if (loading) {
    return <p style={{ fontSize: 14, color: "#888" }}>Loading conflicts...</p>;
  }

  if (error) {
    return (
      <p style={{ fontSize: 14, color: "#c00" }}>
        {error}{" "}
        <button
          type="button"
          onClick={() => fetchConflicts()}
          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14 }}
        >
          Retry
        </button>
      </p>
    );
  }

  if (conflicts.length === 0) {
    return <p style={{ fontSize: 14, color: "#888" }}>No conflicts to review.</p>;
  }

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 8px" }}>
        Migration conflicts ({unresolvedCount} unresolved / {conflicts.length} total)
      </h3>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "6px 8px" }}>Document</th>
            <th style={{ padding: "6px 8px" }}>Status</th>
            <th style={{ padding: "6px 8px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((c) => (
            <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "6px 8px", ...mono }}>{c.documentPath}</td>
              <td style={{ padding: "6px 8px" }}>
                {c.resolution ? (
                  <span style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: c.resolution === "apply" ? "#dcfce7" : c.resolution === "skip" ? "#fef3c7" : "#e0e7ff",
                    color: c.resolution === "apply" ? "#166534" : c.resolution === "skip" ? "#92400e" : "#3730a3",
                  }}>
                    {c.resolution}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 600 }}>unresolved</span>
                )}
              </td>
              <td style={{ padding: "6px 8px" }}>
                {!c.resolution && (
                  <button
                    type="button"
                    onClick={() => setSelectedConflictId(c.id)}
                    style={{ ...primaryButton, padding: "4px 10px", fontSize: 12 }}
                  >
                    Review
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedConflict && (
        <ConflictResolutionPanel
          baseUrl={baseUrl}
          siteId={siteId}
          branchId={branchId}
          jobId={jobId}
          conflict={selectedConflict}
          onResolved={handleResolved}
          onCancel={() => setSelectedConflictId(null)}
        />
      )}
    </div>
  );
}
