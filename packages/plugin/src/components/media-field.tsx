"use client";

import { useState, type ReactElement } from "react";
import type { CustomField } from "@puckeditor/core";
import { MediaLibrary } from "./media-library";

type CropMode = "fit" | "smart";

function getBaseUrl(value: string): string {
  return value ? value.split("?")[0] : "";
}

function getCropMode(value: string): CropMode {
  if (!value) return "fit";
  const params = new URLSearchParams(value.includes("?") ? value.split("?")[1] : "");
  return params.get("fit") === "cover" ? "smart" : "fit";
}

function buildValueWithCrop(baseUrl: string, crop: CropMode): string {
  // baseUrl always has query params stripped by getBaseUrl before being passed here
  return crop === "smart"
    ? `${baseUrl}?fit=cover&gravity=auto`
    : `${baseUrl}?fit=scale-down`;
}

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

  const baseUrl = getBaseUrl(value);
  const cropMode = getCropMode(value);

  const handleCropChange = (crop: CropMode) => {
    if (!baseUrl) return;
    onChange(buildValueWithCrop(baseUrl, crop));
  };

  const handleSelect = (url: string) => {
    onChange(buildValueWithCrop(url.split("?")[0], cropMode));
    setIsLibraryOpen(false);
  };

  const buttonBase: React.CSSProperties = {
    padding: "3px 10px",
    fontSize: "12px",
    fontWeight: 500,
    border: "1px solid #d0d0d0",
    borderRadius: "4px",
    cursor: readOnly ? "not-allowed" : "pointer",
    fontFamily: "inherit",
  };

  return (
    <div style={{ width: "100%" }}>
      {value ? (
        <div style={{ marginBottom: "8px" }}>
          <img
            src={baseUrl}
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

      {value && (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ fontSize: "11px", color: "#666", fontWeight: 500, marginBottom: "4px" }}>
            Crop
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => handleCropChange("fit")}
              style={{
                ...buttonBase,
                backgroundColor: cropMode === "fit" ? "#2563eb" : "white",
                color: cropMode === "fit" ? "white" : "#444",
                borderColor: cropMode === "fit" ? "#2563eb" : "#d0d0d0",
                opacity: readOnly ? 0.5 : 1,
              }}
            >
              Fit in
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => handleCropChange("smart")}
              style={{
                ...buttonBase,
                backgroundColor: cropMode === "smart" ? "#2563eb" : "white",
                color: cropMode === "smart" ? "white" : "#444",
                borderColor: cropMode === "smart" ? "#2563eb" : "#d0d0d0",
                opacity: readOnly ? 0.5 : 1,
              }}
            >
              Smart crop
            </button>
          </div>
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
        onSelect={handleSelect}
      />
    </div>
  );
}
