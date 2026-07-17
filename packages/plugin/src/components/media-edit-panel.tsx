"use client";

import type { RefObject } from "react";
import { MetadataGrid } from "./metadata-grid";
import { panelErrorStyle, panelHeadingStyle, panelButtonRowStyle, primaryBtnStyle, secondaryBtnStyle } from "./media-panel-styles";
import type { MediaItem } from "./media-item";
import type { MetadataFieldDef } from "../types";

/** Metadata-editing panel for an existing library item, with a Replace-image action. */
export function MediaEditPanel(props: {
  editing: MediaItem;
  editFields: MetadataFieldDef[];
  editValues: string[][];
  onValuesChange: (values: string[][]) => void;
  uploading: boolean;
  panelError: string | null;
  onCancel: () => void;
  onSave: () => void;
  onReplaceImage: (file: File | undefined) => void;
  replaceInputRef: RefObject<HTMLInputElement | null>;
}) {
  const {
    editing,
    editFields,
    editValues,
    onValuesChange,
    uploading,
    panelError,
    onCancel,
    onSave,
    onReplaceImage,
    replaceInputRef,
  } = props;

  return (
    <div>
      <div style={{ ...panelHeadingStyle, marginBottom: "12px" }}>Edit details — {editing.filename}</div>
      <MetadataGrid
        fields={editFields}
        rows={[
          {
            key: editing.assetId ?? editing.url,
            label: editing.filename,
            thumbnailUrl: editing.url,
          },
        ]}
        values={editValues}
        onChange={onValuesChange}
        disabled={uploading}
        autoFocus
      />
      {panelError && <div style={panelErrorStyle}>{panelError}</div>}
      <div style={panelButtonRowStyle}>
        <input
          ref={replaceInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => onReplaceImage(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => replaceInputRef.current?.click()}
          disabled={uploading}
          title="Upload a new image as a new version of this asset"
          style={{ ...secondaryBtnStyle(uploading), marginRight: "auto" }}
        >
          Replace image…
        </button>
        <button type="button" onClick={onCancel} disabled={uploading} style={secondaryBtnStyle(uploading)}>
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={uploading} style={primaryBtnStyle(uploading)}>
          {uploading ? "Saving…" : "Save details"}
        </button>
      </div>
    </div>
  );
}
