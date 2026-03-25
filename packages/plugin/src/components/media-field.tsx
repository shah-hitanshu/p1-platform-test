"use client";

import { useState, type ReactElement } from "react";
import type { CustomField } from "@puckeditor/core";
import { MediaLibrary } from "./media-library";

export function MediaFieldRender(props: {
  field: CustomField<string>;
  name: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}): ReactElement {
  const { value, onChange, readOnly } = props;
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);

  return (
    <div style={{ width: "100%" }}>
      {value ? (
        <div style={{ marginBottom: "8px" }}>
          <img
            src={value}
            alt="Preview"
            style={{
              width: "100%",
              maxHeight: "120px",
              objectFit: "cover",
              borderRadius: "6px",
              display: "block",
              border: "1px solid #e0e0e0",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            height: "80px",
            border: "2px dashed #d0d0d0",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "8px",
            color: "#999",
            fontSize: "13px",
            cursor: readOnly ? "default" : "pointer",
          }}
          onClick={() => !readOnly && setIsLibraryOpen(true)}
        >
          Click to select image
        </div>
      )}

      <div style={{ display: "flex", gap: "6px" }}>
        <button
          type="button"
          onClick={() => setIsLibraryOpen(true)}
          disabled={readOnly}
          style={{
            flex: 1,
            padding: "6px 12px",
            backgroundColor: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: readOnly ? "not-allowed" : "pointer",
            opacity: readOnly ? 0.5 : 1,
            fontFamily: "inherit",
          }}
        >
          Choose from Library
        </button>

        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            disabled={readOnly}
            style={{
              padding: "6px 12px",
              backgroundColor: "white",
              color: "#666",
              border: "1px solid #d0d0d0",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: readOnly ? "not-allowed" : "pointer",
              opacity: readOnly ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            Clear
          </button>
        )}
      </div>

      <MediaLibrary
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onSelect={(url) => {
          onChange(url);
          setIsLibraryOpen(false);
        }}
      />
    </div>
  );
}
