"use client";

import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from "react";
import ReactCrop, { centerCrop, makeAspectCrop, type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import type { TrimRect } from "../crop";

/** Fixed presets plus freeform — the "fixed and flexible aspect ratios" surface. */
const ASPECT_PRESETS: { label: string; value: number | undefined }[] = [
  { label: "Free", value: undefined },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
];

function centeredCrop(naturalWidth: number, naturalHeight: number, aspect?: number): PercentCrop {
  if (!aspect) {
    return { unit: "%", x: 10, y: 10, width: 80, height: 80 };
  }
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 80 }, aspect, naturalWidth, naturalHeight),
    naturalWidth,
    naturalHeight,
  );
}

/** Converts an existing source-pixel trim back to a percent crop for editing. */
function trimToPercentCrop(trim: TrimRect, naturalWidth: number, naturalHeight: number): PercentCrop {
  return {
    unit: "%",
    x: (trim.left / naturalWidth) * 100,
    y: (trim.top / naturalHeight) * 100,
    width: (trim.width / naturalWidth) * 100,
    height: (trim.height / naturalHeight) * 100,
  };
}

/**
 * Interactive crop dialog for the rich `p1-media` field. The crop box is kept
 * as a percent crop (stable across preview resizing) and converted to
 * source-pixel `trim.*` values on apply — the stored value stays a plain URL.
 */
export function CropDialog(props: {
  isOpen: boolean;
  /** Bare CDN URL (no transform params) of the image being cropped. */
  imageUrl: string;
  /** Existing manual crop to restore as the starting selection, if any. */
  initialTrim: TrimRect | null;
  onApply: (rect: TrimRect) => void;
  onClose: () => void;
}): ReactElement | null {
  const { isOpen, imageUrl, initialTrim, onApply, onClose } = props;
  const [crop, setCrop] = useState<PercentCrop | undefined>(undefined);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  // Apply is gated on this, not on `crop`: state from a previous open (or a
  // previous image) must never produce a trim for an image that hasn't loaded.
  const [imageLoaded, setImageLoaded] = useState(false);
  const naturalSize = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCrop(undefined);
      setAspect(undefined);
      setImageLoaded(false);
      naturalSize.current = null;
    }
  }, [isOpen, imageUrl]);

  if (!isOpen) return null;

  const handleImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth <= 0 || naturalHeight <= 0) return; // dimensionless source — keep Apply disabled
    naturalSize.current = { width: naturalWidth, height: naturalHeight };
    setImageLoaded(true);
    setCrop(
      initialTrim
        ? trimToPercentCrop(initialTrim, naturalWidth, naturalHeight)
        : centeredCrop(naturalWidth, naturalHeight, undefined),
    );
  };

  const handleAspectChange = (next: number | undefined) => {
    setAspect(next);
    const size = naturalSize.current;
    if (size) setCrop(centeredCrop(size.width, size.height, next));
  };

  const handleApply = () => {
    const size = naturalSize.current;
    if (!size || !imageLoaded || !crop || crop.width <= 0 || crop.height <= 0) return;
    // Clamp to the source bounds — the Worker passes trim.* to Cloudflare
    // Images unclamped, and an out-of-bounds rect fails the whole render.
    const left = Math.min(Math.max((crop.x / 100) * size.width, 0), size.width - 1);
    const top = Math.min(Math.max((crop.y / 100) * size.height, 0), size.height - 1);
    onApply({
      left,
      top,
      width: Math.min((crop.width / 100) * size.width, size.width - left),
      height: Math.min((crop.height / 100) * size.height, size.height - top),
    });
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 10px",
    fontSize: "12px",
    fontWeight: 500,
    border: "1px solid " + (active ? "#2563eb" : "#d0d0d0"),
    borderRadius: "4px",
    cursor: "pointer",
    fontFamily: "inherit",
    backgroundColor: active ? "#2563eb" : "white",
    color: active ? "white" : "#444",
  });

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
          maxWidth: "720px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid #eee",
          }}
        >
          <div style={{ fontSize: "16px", fontWeight: 600 }}>Crop image</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "none",
              fontSize: "18px",
              cursor: "pointer",
              color: "#666",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {ASPECT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handleAspectChange(preset.value)}
              style={chipStyle(aspect === preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div
          style={{
            padding: "0 20px",
            display: "flex",
            justifyContent: "center",
            overflow: "auto",
            maxHeight: "55vh",
          }}
        >
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            aspect={aspect}
            keepSelection
          >
            <img
              src={imageUrl}
              onLoad={handleImageLoad}
              onError={() => setImageLoaded(false)}
              alt="Image to crop"
              style={{ maxWidth: "100%", maxHeight: "55vh", display: "block" }}
            />
          </ReactCrop>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            padding: "16px 20px",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px",
              backgroundColor: "white",
              color: "#666",
              border: "1px solid #d0d0d0",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!imageLoaded || !crop || crop.width <= 0 || crop.height <= 0}
            style={{
              padding: "6px 14px",
              backgroundColor: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Apply crop
          </button>
        </div>
      </div>
    </div>
  );
}
