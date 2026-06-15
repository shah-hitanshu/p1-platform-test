"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMediaConfig } from "../context";

interface MediaLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

interface MediaItem {
  key: string;
  url: string;
  filename: string;
  size?: number;
  lastModified?: string;
}

export function MediaLibrary({ isOpen, onClose, onSelect }: MediaLibraryProps) {
  const config = useMediaConfig();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await config.getAuthToken();
    return token ? { Authorization: "Bearer " + token } : {};
  }, [config]);

  const fetchMedia = useCallback(
    async (search?: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ siteId: config.siteId, workstreamId: config.workstreamId });
        if (search) params.set("search", search);
        const response = await fetch(
          config.workerUrl + "/media?" + params.toString(),
          { headers: await getAuthHeaders() },
        );
        if (response.ok) {
          setMedia(await response.json());
        }
      } catch (error) {
        console.error("Failed to fetch media:", error);
      } finally {
        setLoading(false);
      }
    },
    [config, getAuthHeaders],
  );

  useEffect(() => {
    if (isOpen) {
      fetchMedia();
      setSearchQuery("");
    }
  }, [isOpen, fetchMedia]);

  const searchInitialized = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      searchInitialized.current = false;
      return;
    }
    // Skip the initial run — the open effect already fetches
    if (!searchInitialized.current) {
      searchInitialized.current = true;
      return;
    }
    const timer = setTimeout(() => {
      fetchMedia(searchQuery || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, fetchMedia]);

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const params = new URLSearchParams({ siteId: config.siteId, workstreamId: config.workstreamId });
    const response = await fetch(
      config.workerUrl + "/media?" + params.toString(),
      {
        method: "POST",
        body: formData,
        headers: await getAuthHeaders(),
      },
    );
    return response.ok;
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        await uploadFile(files[i]);
      }
      await fetchMedia(searchQuery || undefined);
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
    handleUpload(e.dataTransfer.files);
  };

  const deleteMedia = async (item: MediaItem) => {
    const confirmed = window.confirm(
      `Delete "${item.filename}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      const params = new URLSearchParams({ siteId: config.siteId, workstreamId: config.workstreamId });
      const encodedKey = item.key
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const response = await fetch(
        config.workerUrl + "/media/" + encodedKey + "?" + params.toString(),
        {
          method: "DELETE",
          headers: await getAuthHeaders(),
        },
      );
      if (response.ok) {
        await fetchMedia(searchQuery || undefined);
      } else {
        console.error("Failed to delete media:", response.statusText);
      }
    } catch (error) {
      console.error("Failed to delete media:", error);
    }
  };

  if (!isOpen) return null;

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
          boxShadow:
            "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
          maxWidth: "900px",
          width: "100%",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #e0e0e0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "20px",
              fontWeight: 600,
              color: "#333",
            }}
          >
            Media Library
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "24px",
              cursor: "pointer",
              color: "#666",
              padding: "0",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "4px",
            }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
          {/* Upload Area */}
          <div
            style={{
              border: dragActive
                ? "2px solid #2563eb"
                : "2px dashed #d0d0d0",
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
              onChange={(e) => handleUpload(e.target.files)}
            />
            <div
              style={{ fontSize: "28px", marginBottom: "8px", color: "#999" }}
            >
              {uploading ? "\u23F3" : "\u2191"}
            </div>
            <div style={{ color: "#666", fontSize: "14px" }}>
              {uploading
                ? "Uploading..."
                : "Drag & drop files here or click to browse"}
            </div>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search by filename..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #e0e0e0",
              borderRadius: "6px",
              fontSize: "14px",
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
              marginBottom: "16px",
            }}
          />

          {/* Grid */}
          {loading ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px",
                color: "#999",
                fontSize: "14px",
              }}
            >
              Loading...
            </div>
          ) : media.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px",
                color: "#999",
                fontSize: "14px",
              }}
            >
              No media found
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: "12px",
              }}
            >
              {media.map((item) => (
                <div
                  key={item.key}
                  style={{
                    position: "relative",
                    cursor: "pointer",
                    border: "2px solid transparent",
                    borderRadius: "8px",
                    overflow: "hidden",
                    transition: "border-color 0.15s",
                    backgroundColor: "#f9f9f9",
                  }}
                  onClick={() => {
                    onSelect(item.url);
                    onClose();
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#2563eb";
                    const btn = e.currentTarget.querySelector(
                      "[data-delete-btn]",
                    ) as HTMLElement | null;
                    if (btn) btn.style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "transparent";
                    const btn = e.currentTarget.querySelector(
                      "[data-delete-btn]",
                    ) as HTMLElement | null;
                    if (btn) btn.style.opacity = "0.6";
                  }}
                >
                  <button
                    data-delete-btn
                    title="Delete image"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMedia(item);
                    }}
                    style={{
                      position: "absolute",
                      top: "4px",
                      right: "4px",
                      zIndex: 1,
                      width: "24px",
                      height: "24px",
                      padding: 0,
                      border: "none",
                      borderRadius: "4px",
                      backgroundColor: "rgba(0, 0, 0, 0.55)",
                      color: "white",
                      fontSize: "14px",
                      lineHeight: "24px",
                      textAlign: "center",
                      cursor: "pointer",
                      opacity: 0.6,
                      transition: "opacity 0.15s, background-color 0.15s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = "1";
                      e.currentTarget.style.backgroundColor =
                        "rgba(220, 38, 38, 0.9)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor =
                        "rgba(0, 0, 0, 0.55)";
                    }}
                  >
                    &times;
                  </button>
                  <img
                    src={item.url}
                    alt={item.filename}
                    style={{
                      width: "100%",
                      height: "120px",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                  <div
                    style={{
                      padding: "6px 8px",
                      fontSize: "11px",
                      color: "#555",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={item.filename}
                  >
                    {item.filename}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
