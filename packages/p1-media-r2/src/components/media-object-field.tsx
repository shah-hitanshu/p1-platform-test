"use client";

import { useState, type ReactElement } from "react";
import { getBaseUrl, getCropMode, getTrimRect, type CropMode, type TrimRect } from "../crop";
import {
  isMediaValue,
  applyCropToValue,
  applyTrimToValue,
  setMetaOnValue,
  buildValueFromAsset,
} from "../media-value";
import type { MediaFieldValue } from "../types";
import { MediaLibrary, type MediaItem } from "./media-library";
import { CropDialog } from "./crop-dialog";
import { useMediaSchema, orderAltFirst } from "./use-media-schema";

/**
 * Object-aware editor UI for the `p1-media` field: image preview + crop
 * controls + schema-driven metadata inputs. Distinct from the basic (string)
 * field — crop params live inside `value.url` and the value is an object.
 */
export function MediaObjectFieldRender(props: {
  label: string;
  name: string;
  id: string;
  value: MediaFieldValue;
  onChange: (value: MediaFieldValue) => void;
  readOnly?: boolean;
}): ReactElement {
  const { value, onChange, readOnly } = props;
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const schema = orderAltFirst(useMediaSchema());

  const isObject = isMediaValue(value);
  const urlString = isObject ? value.url : typeof value === "string" ? value : "";
  const baseUrl = getBaseUrl(urlString);
  const cropMode = getCropMode(urlString);

  // All write paths route through pure helpers in media-value.ts, which
  // hold the R10 invariant (never a partial-identity object) and identity-key
  // guards; the component only wires them to onChange.
  const handleCropChange = (crop: CropMode) => {
    if (!baseUrl) return;
    onChange(applyCropToValue(value, crop));
  };

  const handleApplyTrim = (rect: TrimRect) => {
    onChange(applyTrimToValue(value, rect));
    setIsCropOpen(false);
  };

  const handleMetaChange = (fieldName: string, fieldValue: string) => {
    onChange(setMetaOnValue(value, fieldName, fieldValue));
  };

  const handleSelectItem = (item: MediaItem) => {
    onChange(buildValueFromAsset(item, cropMode));
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid #d0d0d0",
    borderRadius: "4px",
    fontSize: "13px",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div style={{ width: "100%" }}>
      {baseUrl ? (
        <div style={{ marginBottom: "8px" }}>
          <img
            src={urlString}
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

      {baseUrl && (
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
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setIsCropOpen(true)}
              style={{
                ...buttonBase,
                backgroundColor: cropMode === "custom" ? "#2563eb" : "white",
                color: cropMode === "custom" ? "white" : "#444",
                borderColor: cropMode === "custom" ? "#2563eb" : "#d0d0d0",
                opacity: readOnly ? 0.5 : 1,
              }}
            >
              Custom…
            </button>
          </div>
        </div>
      )}

      {baseUrl && (
        <div style={{ marginBottom: "8px" }}>
          {!isObject && (
            <div style={{ fontSize: "11px", color: "#a15c00", marginBottom: "6px" }}>
              Select from the library to add metadata.
            </div>
          )}
          {schema.map((f) => {
            const current =
              isObject && typeof value[f.name] === "string" ? (value[f.name] as string) : "";
            return (
              <div key={f.name} style={{ marginBottom: "8px" }}>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#666",
                    fontWeight: 500,
                    marginBottom: "4px",
                  }}
                >
                  {f.label}
                  {f.required ? " *" : ""}
                </div>
                <input
                  type="text"
                  value={current}
                  disabled={readOnly || !isObject}
                  placeholder={!isObject ? "Re-select image to edit" : ""}
                  onChange={(e) => handleMetaChange(f.name, e.target.value)}
                  style={{ ...inputStyle, opacity: readOnly || !isObject ? 0.6 : 1 }}
                />
              </div>
            );
          })}
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

        {baseUrl && (
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
        onSelect={() => {}}
        onSelectItem={handleSelectItem}
      />

      <CropDialog
        isOpen={isCropOpen}
        imageUrl={baseUrl}
        initialTrim={getTrimRect(urlString)}
        onApply={handleApplyTrim}
        onClose={() => setIsCropOpen(false)}
      />
    </div>
  );
}
