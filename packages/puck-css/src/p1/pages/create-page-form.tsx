"use client";

import { useState, useEffect, useCallback } from "react";

import { primaryButton } from "../../data/styles";
import { useCreateStructure } from "./hooks";
import { useP1Auth } from "../../auth/P1AuthProvider";
import type { ContentRole } from "../../features/content-type-templates/types";
import type { Template } from "../../features/content-type-templates/types";
import { canOverrideUrl } from "../../features/content-type-templates/permissions/role-permissions";
import { scaffoldFromTemplate } from "../../features/content-type-templates/editor/useTemplateScaffold";

export interface CreatePageFormProps {
  baseUrl?: string;
  siteId?: string;
  branchId?: string;
  userRole?: ContentRole;
}

export function CreatePageForm({ baseUrl, siteId, branchId, userRole = 'editor' }: CreatePageFormProps) {
  const [path, setPath] = useState("/contact-us");
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsSuccess, setMessageIsSuccess] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const createMutation = useCreateStructure("page");
  const { getToken } = useP1Auth();

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const pathLocked = selectedTemplate?.defaultUrlPattern && !canOverrideUrl(userRole);

  useEffect(() => {
    if (!baseUrl || !siteId || !branchId) return;
    let cancelled = false;
    setTemplatesLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(
          `${baseUrl}/api/sites/${encodeURIComponent(siteId)}/branches/${encodeURIComponent(branchId)}/templates`,
          { method: "GET", headers }
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          setTemplates((data as { templates: Template[] }).templates ?? []);
        }
      } catch {
        // Silently fail — templates are optional enhancement
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [baseUrl, siteId, branchId, getToken]);

  const handleTemplateChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "") {
      setSelectedTemplateId(null);
      return;
    }
    setSelectedTemplateId(value);
    const template = templates.find((t) => t.id === value);
    if (template?.defaultUrlPattern) {
      setPath(template.defaultUrlPattern);
    }
  }, [templates]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const initialData = selectedTemplate ? scaffoldFromTemplate(selectedTemplate as Template) : undefined;
    createMutation.mutate(
      selectedTemplate
        ? { path, initialData, templateId: selectedTemplate.id, templateVersion: selectedTemplate.version }
        : (initialData ? { path, initialData } : path),
      {
        onSuccess: (resultPath) => { setMessageIsSuccess(true); setMessage(`Created page ${resultPath}`); },
        onError: (err) => { setMessageIsSuccess(false); setMessage(err.message); },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {templates.length > 0 && (
        <select
          value={selectedTemplateId ?? ""}
          onChange={handleTemplateChange}
          style={{
            padding: "8px 10px",
            fontSize: 14,
            border: "1px solid #ccc",
            borderRadius: 4,
            background: "#fff",
          }}
        >
          <option value="">Blank page</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label || t.name}
            </option>
          ))}
        </select>
      )}
      {templatesLoading && (
        <span style={{ fontSize: 12, color: "#888" }}>Loading templates...</span>
      )}
      <input
        name="path"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/contact-us"
        disabled={!!pathLocked}
        title={pathLocked ? "URL is set by the template and cannot be changed with your role" : undefined}
        style={{
          padding: "8px 10px",
          minWidth: 220,
          fontFamily: "ui-monospace, monospace",
          fontSize: 14,
          border: "1px solid #ccc",
          borderRadius: 4,
          background: pathLocked ? "#f5f5f5" : "#fff",
          opacity: pathLocked ? 0.7 : 1,
        }}
      />
      <button
        type="submit"
        disabled={createMutation.isPending}
        style={{ ...primaryButton, padding: "8px 14px", fontSize: 14, cursor: createMutation.isPending ? "wait" : undefined }}
      >
        {createMutation.isPending ? "Creating…" : "Add page"}
      </button>
      {message && (
        <span role="alert" style={{ fontSize: 13, color: messageIsSuccess ? "#0a0" : "#c00" }}>
          {message}
        </span>
      )}
    </form>
  );
}
