"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { MediaItem } from "./media-item";

// Tiles are revealed in batches as a sentinel scrolls into view, so a large
// library doesn't render everything at once (tile images also load lazily).
const TILE_BATCH = 60;

/** Searchable, keyboard-navigable grid of existing library items. */
export function MediaGrid(props: {
  media: MediaItem[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectItem: (item: MediaItem) => void;
  onStartEdit: (item: MediaItem) => void;
  onDeleteItem: (item: MediaItem) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  // Owned by the parent (not this component) so a temporary switch to the
  // upload/edit panel and back — which unmounts/remounts this grid — doesn't
  // reset which tile was focused. The parent resets it to 0 on each fetch.
  focusIdx: number;
  onFocusIdxChange: (idx: number) => void;
}) {
  const {
    media,
    loading,
    searchQuery,
    onSearchChange,
    onSelectItem,
    onStartEdit,
    onDeleteItem,
    scrollRef,
    focusIdx,
    onFocusIdxChange,
  } = props;

  const [visibleCount, setVisibleCount] = useState(TILE_BATCH);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Array<HTMLDivElement | null>>([]);

  // A fresh fetch (new search or initial load) always starts back at the top.
  useEffect(() => {
    setVisibleCount(TILE_BATCH);
  }, [media]);

  // Reveal the next tile batch when the sentinel enters the scroll viewport.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + TILE_BATCH);
        }
      },
      { root: scrollRef.current, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [media.length, visibleCount, scrollRef]);

  // Grid columns are responsive (auto-fill); count the tiles sharing the
  // first tile's offsetTop instead of assuming a fixed column count.
  const computeColumns = (): number => {
    const tiles = tileRefs.current.filter((t): t is HTMLDivElement => t !== null);
    if (tiles.length <= 1) return 1;
    const firstTop = tiles[0].offsetTop;
    let columns = 0;
    for (const tile of tiles) {
      if (tile.offsetTop !== firstTop) break;
      columns++;
    }
    return Math.max(1, columns);
  };

  const focusTile = (index: number) => {
    onFocusIdxChange(index);
    tileRefs.current[index]?.focus();
  };

  const handleTileKeyDown = (e: React.KeyboardEvent, index: number, item: MediaItem) => {
    const rendered = Math.min(media.length, visibleCount);
    const columns = computeColumns();
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        next = Math.min(index + 1, rendered - 1);
        break;
      case "ArrowLeft":
        next = Math.max(index - 1, 0);
        break;
      case "ArrowDown":
        next = Math.min(index + columns, rendered - 1);
        break;
      case "ArrowUp":
        next = Math.max(index - columns, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = rendered - 1;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onSelectItem(item);
        return;
      case "e":
      case "E":
        if (item.assetId) {
          e.preventDefault();
          onStartEdit(item);
        }
        return;
      case "Delete":
      case "Backspace":
        if (item.assetId) {
          e.preventDefault();
          setConfirmDeleteId(item.assetId);
        }
        return;
      case "Escape":
        if (confirmDeleteId) {
          e.preventDefault();
          setConfirmDeleteId(null);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    focusTile(next);
  };

  return (
    <>
      {/* Search */}
      <input
        type="text"
        placeholder="Search by filename or metadata..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
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
        <div style={{ textAlign: "center", padding: "40px", color: "#999", fontSize: "14px" }}>Loading...</div>
      ) : media.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#999", fontSize: "14px" }}>No media found</div>
      ) : (
        <div
          role="listbox"
          aria-label="Media items — arrow keys to navigate, Enter to select, E to edit, Delete to remove"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: "12px",
          }}
        >
          {media.slice(0, visibleCount).map((item, i) => (
            <div
              key={item.assetId ?? item.url}
              ref={(el) => {
                tileRefs.current[i] = el;
              }}
              role="option"
              aria-selected={false}
              aria-label={item.filename}
              tabIndex={i === Math.min(focusIdx, Math.min(media.length, visibleCount) - 1) ? 0 : -1}
              style={{
                position: "relative",
                cursor: "pointer",
                border: "2px solid transparent",
                borderRadius: "8px",
                overflow: "hidden",
                transition: "border-color 0.15s",
                backgroundColor: "#f9f9f9",
                outline: "none",
              }}
              onClick={() => onSelectItem(item)}
              onKeyDown={(e) => handleTileKeyDown(e, i, item)}
              onFocus={(e) => {
                onFocusIdxChange(i);
                e.currentTarget.style.borderColor = "#2563eb";
                e.currentTarget.style.boxShadow = "0 0 0 2px rgba(37, 99, 235, 0.35)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.boxShadow = "none";
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#2563eb";
                e.currentTarget
                  .querySelectorAll<HTMLElement>("[data-delete-btn], [data-edit-btn]")
                  .forEach((btn) => (btn.style.opacity = "1"));
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget
                  .querySelectorAll<HTMLElement>("[data-delete-btn], [data-edit-btn]")
                  .forEach((btn) => (btn.style.opacity = "0.6"));
              }}
            >
              {item.assetId && (
                <button
                  data-edit-btn
                  title="Edit details"
                  aria-label={`Edit details for ${item.filename}`}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEdit(item);
                  }}
                  style={{
                    position: "absolute",
                    top: "4px",
                    right: "32px",
                    zIndex: 1,
                    width: "24px",
                    height: "24px",
                    padding: 0,
                    border: "none",
                    borderRadius: "4px",
                    backgroundColor: "rgba(0, 0, 0, 0.55)",
                    color: "white",
                    fontSize: "12px",
                    lineHeight: "24px",
                    textAlign: "center",
                    cursor: "pointer",
                    opacity: 0.6,
                    transition: "opacity 0.15s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  &#9998;
                </button>
              )}
              {item.assetId && (
                <button
                  data-delete-btn
                  title="Delete image"
                  aria-label={`Delete ${item.filename}`}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(item.assetId ?? null);
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
                    e.currentTarget.style.backgroundColor = "rgba(220, 38, 38, 0.9)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.55)";
                  }}
                >
                  &times;
                </button>
              )}
              <img
                src={item.url}
                alt={item.filename}
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "120px", objectFit: "cover", display: "block" }}
              />
              {item.assetId && confirmDeleteId === item.assetId && (
                <div
                  role="alertdialog"
                  aria-label={`Delete ${item.filename}?`}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    // Keep tile-level navigation from hijacking the dialog
                    e.stopPropagation();
                    if (e.key === "Escape") {
                      setConfirmDeleteId(null);
                      tileRefs.current[i]?.focus();
                    }
                  }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 2,
                    backgroundColor: "rgba(0, 0, 0, 0.72)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    padding: "8px",
                  }}
                >
                  <div style={{ color: "white", fontSize: "12px", fontWeight: 600, textAlign: "center" }}>
                    Delete this image?
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      autoFocus
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                        onDeleteItem(item);
                      }}
                      style={{
                        padding: "4px 10px",
                        backgroundColor: "#dc2626",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                        tileRefs.current[i]?.focus();
                      }}
                      style={{
                        padding: "4px 10px",
                        backgroundColor: "white",
                        color: "#444",
                        border: "none",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
      {media.length > visibleCount && <div ref={sentinelRef} aria-hidden="true" style={{ height: "1px" }} />}
    </>
  );
}
