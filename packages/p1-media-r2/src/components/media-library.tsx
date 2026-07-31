"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMediaConfig, type MediaConfig } from "../context";
import { useMediaSchema, orderAltFirst } from "./use-media-schema";
import { buildPatchBody, keepIncompleteRows } from "./staging";
import { parseMediaList, type MediaItem } from "./media-item";
import {
  runUpload,
  UploadFlowError,
  STAGED_STATUS,
  type RowStatus,
  type UploadProgress,
  type UploadTarget,
} from "./upload-flow";
import { MediaUploadDropzone } from "./media-upload-dropzone";
import { MediaUploadPanel } from "./media-upload-panel";
import { MediaEditPanel } from "./media-edit-panel";
import { MediaGrid } from "./media-grid";
import type { MetadataFieldDef } from "../types";

export type { MediaItem } from "./media-item";

interface MediaLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  /** Basic mode: receives the bare CDN URL of the picked item. */
  onSelect: (url: string) => void;
  /**
   * Rich mode (p1-media): receives the full item, including asset identity and
   * metadata defaults when the Worker returns the asset-shaped list. Takes
   * precedence over `onSelect` when provided.
   */
  onSelectItem?: (item: MediaItem) => void;
}

// The Worker caps list responses at 500; ask for the max rather than its
// 200 default so large libraries are actually reachable by scrolling.
const LIST_LIMIT = "500";

// workstreamId is accepted for forward-compat but not read by the Worker —
// omit it entirely rather than sending a meaningless placeholder value.
function siteParams(config: Pick<MediaConfig, "siteId" | "workstreamId">): URLSearchParams {
  const params = new URLSearchParams({ siteId: config.siteId });
  if (config.workstreamId) params.set("workstreamId", config.workstreamId);
  return params;
}

export function MediaLibrary({ isOpen, onClose, onSelect, onSelectItem }: MediaLibraryProps) {
  const config = useMediaConfig();
  const schema = orderAltFirst(useMediaSchema());
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Owned here (not MediaGrid) so switching to the upload/edit panel and back
  // — which unmounts/remounts the grid — doesn't lose the focused tile.
  const [focusIdx, setFocusIdx] = useState(0);
  // Files staged for upload — shown in the metadata grid before POSTing.
  const [pending, setPending] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [pendingValues, setPendingValues] = useState<string[][]>([]);
  // Per-row upload progress/status, position-matched with `pending`. `progress`
  // survives a failed attempt so a retry resumes from the step that failed
  // instead of redoing presign/PUT/finalize from scratch.
  const [pendingProgress, setPendingProgress] = useState<UploadProgress[]>([]);
  const [pendingStatus, setPendingStatus] = useState<RowStatus[]>([]);
  // Existing item whose metadata is being edited. editFields is the schema
  // SNAPSHOT taken when the edit began — the grid columns and the PATCH body
  // both use it, so a schema fetch resolving mid-edit can't add columns whose
  // empty cells would clear (null) metadata the user never touched.
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [editFields, setEditFields] = useState<MetadataFieldDef[]>([]);
  const [editValues, setEditValues] = useState<string[][]>([]);
  const [panelError, setPanelError] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await config.getAuthToken();
    return token ? { Authorization: "Bearer " + token } : {};
  }, [config]);

  const fetchMedia = useCallback(
    async (search?: string) => {
      setLoading(true);
      try {
        const params = siteParams(config);
        params.set("limit", LIST_LIMIT);
        if (search) params.set("search", search);
        const response = await fetch(
          config.workerUrl + "/media?" + params.toString(),
          { headers: await getAuthHeaders() },
        );
        if (response.ok) {
          setMedia(parseMediaList(await response.json()));
          setFocusIdx(0);
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

  // Chosen/dropped files are STAGED first: the metadata grid prompts for
  // alt/caption/… per file, then "Upload" POSTs each file with its row.
  const stageFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const staged = Array.from(files).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPending(staged);
    setPendingValues(staged.map(() => schema.map(() => "")));
    setPendingProgress(staged.map(() => ({})));
    setPendingStatus(staged.map(() => STAGED_STATUS));
    setPanelError(null);
  };

  const clearPending = useCallback(() => {
    setPending((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
    setPendingValues([]);
    setPendingProgress([]);
    setPendingStatus([]);
    setPanelError(null);
  }, []);

  // Modal closed with a staged upload → drop it (and its object URLs).
  useEffect(() => {
    if (!isOpen) {
      clearPending();
      setEditing(null);
    }
  }, [isOpen, clearPending]);

  const uploadAll = async () => {
    setUploading(true);
    setPanelError(null);
    const target: UploadTarget = {
      workerUrl: config.workerUrl,
      siteId: config.siteId,
      workstreamId: config.workstreamId,
      getAuthHeaders,
    };
    // Per-row outcome: retrying must never re-POST a file that already
    // finished (duplicate assets). Each row is caught individually below, so
    // one file's failure never aborts the rest of the batch.
    const progress = pending.map((_, i) => pendingProgress[i] ?? {});
    const statuses = pending.map((_, i) => pendingStatus[i] ?? STAGED_STATUS);
    for (let i = 0; i < pending.length; i++) {
      const metadata: Record<string, string> = {};
      schema.forEach((f, c) => {
        const value = pendingValues[i]?.[c]?.trim();
        if (value) metadata[f.name] = value;
      });
      try {
        const result = await runUpload(target, pending[i].file, metadata, undefined, progress[i], (step) => {
          statuses[i] = { step };
          setPendingStatus([...statuses]);
        });
        progress[i] = result.progress;
        statuses[i] = { step: "done" };
      } catch (error) {
        const message = error instanceof UploadFlowError ? error.message : "Upload failed";
        if (error instanceof UploadFlowError) progress[i] = error.progress;
        statuses[i] = { step: "failed", error: message };
        console.error("Upload failed:", error);
      }
      setPendingProgress([...progress]);
      setPendingStatus([...statuses]);
    }
    try {
      if (statuses.every((s) => s.step === "done")) {
        clearPending();
      } else {
        // Drop finished rows (and release their previews); keep the rest with
        // their typed metadata AND progress so Upload retries resume from the
        // step that failed rather than redoing presign/PUT/finalize.
        pending.forEach((p, i) => {
          if (statuses[i].step === "done") URL.revokeObjectURL(p.previewUrl);
        });
        const kept = keepIncompleteRows(pending, pendingValues, progress, statuses);
        setPending(kept.rows);
        setPendingValues(kept.values);
        setPendingProgress(kept.progress);
        setPendingStatus(kept.statuses);
        const failures = kept.rows.length;
        setPanelError(
          `${failures} of ${pending.length} uploads failed — successful files are already in the library; only the failed rows below will be retried`,
        );
      }
      await fetchMedia(searchQuery || undefined);
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (item: MediaItem) => {
    setEditing(item);
    setEditFields(schema);
    setEditValues([schema.map((f) => item.metadata?.[f.name] ?? "")]);
    setPanelError(null);
  };

  const saveEdit = async () => {
    if (!editing?.assetId) return;
    setUploading(true);
    setPanelError(null);
    try {
      // Flat map per the PATCH contract; empty cells clear via null. Built
      // from the edit-time field snapshot, never the live schema.
      const body = buildPatchBody(editFields, editValues[0] ?? []);
      const params = siteParams(config);
      const response = await fetch(
        config.workerUrl + "/media/" + encodeURIComponent(editing.assetId) + "?" + params.toString(),
        {
          method: "PATCH",
          body: JSON.stringify(body),
          headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
        },
      );
      if (response.ok) {
        setEditing(null);
        await fetchMedia(searchQuery || undefined);
      } else {
        setPanelError("Failed to save metadata");
      }
    } catch (error) {
      console.error("Failed to save metadata:", error);
      setPanelError("Failed to save metadata");
    } finally {
      setUploading(false);
    }
  };

  // "Replace image" in the edit panel: uploads the chosen file as a NEW
  // immutable version of the asset (POST /media/:assetId/versions) and
  // repoints current_version — metadata is untouched.
  const replaceImage = async (file: File | undefined) => {
    if (!file || !editing?.assetId) return;
    setUploading(true);
    setPanelError(null);
    try {
      const target: UploadTarget = {
        workerUrl: config.workerUrl,
        siteId: config.siteId,
        workstreamId: config.workstreamId,
        getAuthHeaders,
      };
      // Metadata is untouched by a replace — no metadata to send.
      const { item } = await runUpload(target, file, undefined, editing.assetId, {}, () => {});
      // Show the new version in the panel; the list refreshes on save/close.
      setEditing(item);
      await fetchMedia(searchQuery || undefined);
    } catch (error) {
      console.error("Failed to replace image:", error);
      setPanelError(
        error instanceof UploadFlowError ? `Failed to replace image: ${error.message}` : "Failed to replace image",
      );
    } finally {
      setUploading(false);
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  };

  const selectItem = (item: MediaItem) => {
    if (onSelectItem) {
      onSelectItem(item);
    } else {
      onSelect(item.url);
    }
    onClose();
  };

  // Two-step inline delete: the tile's × button (or Delete key) arms a
  // per-tile confirmation overlay instead of window.confirm — a native
  // dialog blocks the whole page (including any browser automation driving it).
  const deleteItem = (item: MediaItem) => {
    if (!item.assetId) return; // soft delete is by assetId (frozen contract)
    (async () => {
      try {
        const params = siteParams(config);
        const response = await fetch(
          config.workerUrl + "/media/" + encodeURIComponent(item.assetId!) + "?" + params.toString(),
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
    })();
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
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600, color: "#333" }}>Media Library</h2>
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
        <div ref={scrollRef} style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
          {pending.length > 0 ? (
            <MediaUploadPanel
              schema={schema}
              pending={pending}
              pendingValues={pendingValues}
              onValuesChange={setPendingValues}
              pendingStatus={pendingStatus}
              uploading={uploading}
              panelError={panelError}
              onCancel={clearPending}
              onUpload={uploadAll}
            />
          ) : editing ? (
            <MediaEditPanel
              editing={editing}
              editFields={editFields}
              editValues={editValues}
              onValuesChange={setEditValues}
              uploading={uploading}
              panelError={panelError}
              onCancel={() => setEditing(null)}
              onSave={saveEdit}
              onReplaceImage={replaceImage}
              replaceInputRef={replaceInputRef}
            />
          ) : (
            <>
              <MediaUploadDropzone uploading={uploading} onFilesSelected={stageFiles} />
              <MediaGrid
                media={media}
                loading={loading}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSelectItem={selectItem}
                onStartEdit={startEdit}
                onDeleteItem={deleteItem}
                scrollRef={scrollRef}
                focusIdx={focusIdx}
                onFocusIdxChange={setFocusIdx}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
