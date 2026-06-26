"use client";

import { useState, useCallback } from "react";
import { primaryButton } from "../../data/styles";
import { useP1Auth } from "../../auth/P1AuthProvider";

export interface CreateContentTypeFormProps {
  baseUrl: string;
  siteId: string;
  branchId: string;
}

function toKebabCase(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateContentTypeForm({
  baseUrl,
  siteId,
  branchId,
}: CreateContentTypeFormProps) {
  const [label, setLabel] = useState("");
  const [defaultUrlPattern, setDefaultUrlPattern] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsSuccess, setMessageIsSuccess] = useState(false);
  const { getToken } = useP1Auth();

  const derivedName = toKebabCase(label);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!label.trim()) {
        setMessage("Label is required");
        return;
      }
      const name = toKebabCase(label);
      if (!name) {
        setMessage("Label must contain at least one letter or number");
        return;
      }
      const trimmedPattern = defaultUrlPattern.trim();
      if (trimmedPattern && !trimmedPattern.startsWith('/')) {
        setMessage("URL pattern must start with /");
        return;
      }
      if (trimmedPattern && /[?#]/.test(trimmedPattern)) {
        setMessage("URL pattern must not contain ? or #");
        return;
      }
      setPending(true);
      setMessage(null);
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(
          `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              name,
              label: label.trim(),
              ...(defaultUrlPattern.trim() ? { defaultUrlPattern: defaultUrlPattern.trim() } : {}),
              components: [],
            }),
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as any).error ?? `Failed (${res.status})`);
        }

        setMessageIsSuccess(true);
        setMessage(`Created "${label.trim()}".`);
        setLabel("");
        setDefaultUrlPattern("");
        window.dispatchEvent(new CustomEvent("p1:template-created"));
      } catch (err) {
        setMessageIsSuccess(false);
        setMessage(err instanceof Error ? err.message : "Failed to create content type");
      } finally {
        setPending(false);
      }
    },
    [label, defaultUrlPattern, baseUrl, siteId, branchId, getToken]
  );

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <label style={{ fontSize: 12, color: "#666" }}>Label</label>
        <input
          name="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Blog Post"
          style={{
            padding: "8px 10px",
            minWidth: 200,
            fontSize: 14,
            border: "1px solid #ccc",
            borderRadius: 4,
            background: "#fff",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <label style={{ fontSize: 12, color: "#666" }}>Default URL pattern (optional)</label>
        <input
          name="defaultUrlPattern"
          value={defaultUrlPattern}
          onChange={(e) => setDefaultUrlPattern(e.target.value)}
          placeholder="/blog/:year/:month/:slug"
          style={{
            padding: "8px 10px",
            minWidth: 200,
            fontFamily: "ui-monospace, monospace",
            fontSize: 14,
            border: "1px solid #ccc",
            borderRadius: 4,
            background: "#fff",
          }}
        />
      </div>
      <button
        type="submit"
        disabled={pending || !derivedName}
        style={{
          ...primaryButton,
          padding: "8px 14px",
          fontSize: 14,
          cursor: pending ? "wait" : undefined,
          opacity: !derivedName ? 0.5 : 1,
        }}
      >
        {pending ? "Creating..." : "Add content type"}
      </button>
      {message && (
        <span
          role="alert"
          style={{
            fontSize: 13,
            color: messageIsSuccess ? "#0a0" : "#c00",
          }}
        >
          {message}
        </span>
      )}
    </form>
  );
}
