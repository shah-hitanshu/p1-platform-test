"use client";

import type { MetadataFieldDef } from "../types";
import { MetadataGrid } from "./metadata-grid";
import { panelErrorStyle, panelHeadingStyle, panelButtonRowStyle, primaryBtnStyle, secondaryBtnStyle } from "./media-panel-styles";
import type { RowStatus } from "./upload-flow";

const STEP_LABEL: Record<RowStatus["step"], string | null> = {
  staged: null,
  presigning: "Preparing…",
  uploading: "Uploading…",
  finalizing: "Finalizing…",
  done: "Done",
  failed: null, // uses the row's own error message instead
};

function statusBadge(status: RowStatus | undefined): { text: string; isError?: boolean } | undefined {
  if (!status) return undefined;
  if (status.step === "failed") return { text: status.error ?? "Failed", isError: true };
  const text = STEP_LABEL[status.step];
  return text ? { text } : undefined;
}

/** Staged-file metadata grid shown after files are chosen/dropped, before POSTing. */
export function MediaUploadPanel(props: {
  schema: MetadataFieldDef[];
  pending: { file: File; previewUrl: string }[];
  pendingValues: string[][];
  onValuesChange: (values: string[][]) => void;
  pendingStatus: RowStatus[];
  uploading: boolean;
  panelError: string | null;
  onCancel: () => void;
  onUpload: () => void;
}) {
  const { schema, pending, pendingValues, onValuesChange, pendingStatus, uploading, panelError, onCancel, onUpload } =
    props;

  return (
    <div>
      <div style={panelHeadingStyle}>
        Add details for {pending.length} {pending.length === 1 ? "image" : "images"}
      </div>
      <div style={{ fontSize: "12px", color: "#888", marginBottom: "12px" }}>
        Tab, Enter and the arrow keys move between cells. Paste TSV or CSV from a
        spreadsheet to fill many rows at once — include a header row (alt, caption,
        …) plus an optional filename column to map values automatically.
      </div>
      <MetadataGrid
        fields={schema}
        rows={pending.map((p, i) => ({
          key: i + "-" + p.file.name,
          label: p.file.name,
          thumbnailUrl: p.previewUrl,
          status: statusBadge(pendingStatus[i]),
        }))}
        values={pendingValues}
        onChange={onValuesChange}
        disabled={uploading}
        autoFocus
      />
      {panelError && <div style={panelErrorStyle}>{panelError}</div>}
      <div style={panelButtonRowStyle}>
        <button type="button" onClick={onCancel} disabled={uploading} style={secondaryBtnStyle(uploading)}>
          Cancel
        </button>
        <button type="button" onClick={onUpload} disabled={uploading} style={primaryBtnStyle(uploading)}>
          {uploading ? "Uploading…" : `Upload ${pending.length} ${pending.length === 1 ? "image" : "images"}`}
        </button>
      </div>
    </div>
  );
}
