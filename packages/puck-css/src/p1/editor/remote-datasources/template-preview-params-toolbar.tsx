"use client";

import { useP1Router } from "../../router-context";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  isCanonicalTemplatePath,
  templatePathParamNames,
} from "../../../data/route-templates";
import {
  infoPanel,
  mono,
  muted,
  primaryButton,
} from "../../../data/styles";
import { useSavePreviewMeta } from "../hooks/api-hooks";

export function TemplatePreviewParamsToolbar({
  editorPath,
  routeTemplateKeys,
  savedPreviewParams,
}: {
  editorPath: string;
  routeTemplateKeys: string[];
  savedPreviewParams: Record<string, string>;
}) {
  const router = useP1Router();
  const { pathname, searchParams } = router;
  const previewMeta = useSavePreviewMeta();
  const paramNames = useMemo(
    () => templatePathParamNames(editorPath),
    [editorPath],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const p of paramNames) {
      const fromUrl = searchParams.get(p)?.trim();
      next[p] = fromUrl || savedPreviewParams[p]?.trim() || "";
    }
    setDrafts(next);
  }, [editorPath, paramNames, searchParams, savedPreviewParams]);

  const apply = useCallback(() => {
    const cleaned: Record<string, string> = {};
    for (const p of paramNames) {
      const v = (drafts[p] ?? "").trim();
      if (v) {
        cleaned[p] = v;
      }
    }
    previewMeta.mutate({ path: editorPath, previewParams: cleaned });

    const q = new URLSearchParams(searchParams.toString());
    for (const p of paramNames) {
      const v = (drafts[p] ?? "").trim();
      if (v) {
        q.set(p, v);
      } else {
        q.delete(p);
      }
    }
    const qs = q.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    router.replace(target, { scroll: false });
    router.refresh();
  }, [drafts, editorPath, paramNames, pathname, previewMeta, router, searchParams]);

  if (
    !isCanonicalTemplatePath(editorPath, routeTemplateKeys) ||
    paramNames.length === 0
  ) {
    return null;
  }

  const hasId = paramNames.includes("id");

  return (
    <div style={infoPanel}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
        Template preview
      </div>
      <p style={{ ...muted, margin: "0 0 10px" }}>
        Editing collection template <code style={mono}>{editorPath}</code>.{" "}
        <strong>Apply</strong> saves these values as page metadata (
        <code style={mono}>page-editor-meta.json</code>) and syncs the URL.
        Query string wins over saved metadata when both are set.
        {hasId ? (
          <>
            {" "}
            A numeric <code style={mono}>id</code> is passed to remote
            datasource fetchers for preview.
          </>
        ) : null}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {paramNames.map((p) => (
          <label
            key={p}
            style={{
              ...muted,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ minWidth: 72, ...mono }}>{p}</span>
            <input
              value={drafts[p] ?? ""}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [p]: e.target.value }))
              }
              onKeyDown={(e) => e.key === "Enter" && apply()}
              placeholder={`:${p}`}
              style={{
                ...mono,
                flex: 1,
                minWidth: 120,
                padding: "6px 8px",
                borderRadius: 4,
                border: "1px solid var(--puck-color-grey-09, #e5e7eb)",
                fontSize: 13,
              }}
            />
          </label>
        ))}
        <div>
          <button type="button" onClick={apply} style={primaryButton}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
