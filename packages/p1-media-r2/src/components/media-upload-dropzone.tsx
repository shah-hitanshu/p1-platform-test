"use client";

import { useRef, useState } from "react";

/** Drag-and-drop / click-to-browse file picker shown in the library's browse view. */
export function MediaUploadDropzone(props: {
  uploading: boolean;
  onFilesSelected: (files: FileList | null) => void;
}) {
  const { uploading, onFilesSelected } = props;
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    onFilesSelected(e.dataTransfer.files);
  };

  return (
    <div
      style={{
        border: dragActive ? "2px solid #2563eb" : "2px dashed #d0d0d0",
        borderRadius: "8px",
        padding: "32px",
        textAlign: "center",
        marginBottom: "16px",
        cursor: "pointer",
        backgroundColor: dragActive ? "#eff6ff" : "#fafafa",
        transition: "all 0.2s",
      }}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => onFilesSelected(e.target.files)}
      />
      <div style={{ fontSize: "28px", marginBottom: "8px", color: "#999" }}>
        {uploading ? "⏳" : "↑"}
      </div>
      <div style={{ color: "#666", fontSize: "14px" }}>
        {uploading ? "Uploading..." : "Drag & drop files here or click to browse"}
      </div>
    </div>
  );
}
