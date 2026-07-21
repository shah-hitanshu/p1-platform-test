"use client";

import {
  remoteDatasourceTemplateSuggestions,
  getActiveRemoteDatasourceInterpolation,
  type TemplateSuggestion,
} from "../../data/template-autocomplete";
import type { RemoteDatasourceDefinition } from "../../data/remote-datasources/remote-datasource-registry";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  children: ReactNode;
  readOnly?: boolean;
  onChange: (value: string, ui?: unknown) => void;
  registry?: RemoteDatasourceDefinition[];
};

function isTextControl(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

type InterpolationSnapshot = { value: string; openIdx: number; cursor: number };
type OverlaySegment = { text: string; isTemplate: boolean };
type OverlayState = {
  value: string;
  rect: { top: number; left: number; width: number; height: number };
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  lineHeight: string;
  font: string;
  letterSpacing: string;
  whiteSpace: "pre" | "pre-wrap";
  scrollTop: number;
  scrollLeft: number;
  borderRadius: string;
};

const hasTemplateToken = (value: string) => value.includes("{{");

function splitTemplateSegments(value: string): OverlaySegment[] {
  const out: OverlaySegment[] = [];
  let i = 0;
  while (i < value.length) {
    const open = value.indexOf("{{", i);
    if (open === -1) {
      out.push({ text: value.slice(i), isTemplate: false });
      break;
    }
    if (open > i) {
      out.push({ text: value.slice(i, open), isTemplate: false });
    }
    const close = value.indexOf("}}", open + 2);
    const end = close === -1 ? value.length : close + 2;
    out.push({ text: value.slice(open, end), isTemplate: true });
    i = end;
  }
  return out.length > 0 ? out : [{ text: value, isTemplate: false }];
}

function parsePx(input: string): number {
  const n = Number.parseFloat(input);
  return Number.isFinite(n) ? n : 0;
}

export function TemplateAutocompleteLayer({
  children,
  readOnly,
  onChange,
  registry,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeControlRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const styledControlRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const skipSuggestUntilInputRef = useRef(false);
  /** Last open `{{…` span (from refresh); click can blur the input before mousedown runs, so we must not rely on selection alone. */
  const interpolationRef = useRef<InterpolationSnapshot | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);

  const [menu, setMenu] = useState<{
    items: TemplateSuggestion[];
    highlight: number;
    openIdx: number;
    cursor: number;
    rect: DOMRect;
  } | null>(null);

  const closeMenu = useCallback(() => {
    interpolationRef.current = null;
    setMenu(null);
  }, []);

  const setControlHighlightMode = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement | null, enabled: boolean) => {
      if (!el) return;
      if (enabled) {
        el.style.color = "transparent";
        el.style.webkitTextFillColor = "transparent";
        el.style.backgroundColor = "transparent";
        el.style.caretColor = "var(--puck-color-grey-02, #111827)";
        return;
      }
      el.style.color = "";
      el.style.webkitTextFillColor = "";
      el.style.backgroundColor = "";
      el.style.caretColor = "";
    },
    []
  );

  const updateOverlayFromControl = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (!el || readOnly) {
        setControlHighlightMode(styledControlRef.current, false);
        styledControlRef.current = null;
        setOverlay(null);
        return;
      }
      const value = el.value ?? "";
      if (!hasTemplateToken(value)) {
        setControlHighlightMode(styledControlRef.current, false);
        styledControlRef.current = null;
        setOverlay(null);
        return;
      }
      const root = containerRef.current;
      if (!root) return;

      const cs = window.getComputedStyle(el);
      const rootRect = root.getBoundingClientRect();
      const rect = el.getBoundingClientRect();

      setOverlay({
        value,
        rect: {
          top: rect.top - rootRect.top,
          left: rect.left - rootRect.left,
          width: rect.width,
          height: rect.height,
        },
        paddingTop: parsePx(cs.paddingTop),
        paddingRight: parsePx(cs.paddingRight),
        paddingBottom: parsePx(cs.paddingBottom),
        paddingLeft: parsePx(cs.paddingLeft),
        lineHeight: cs.lineHeight,
        font: cs.font,
        letterSpacing: cs.letterSpacing,
        whiteSpace: el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
        borderRadius: cs.borderRadius,
      });
      if (styledControlRef.current && styledControlRef.current !== el) {
        setControlHighlightMode(styledControlRef.current, false);
      }
      setControlHighlightMode(el, true);
      styledControlRef.current = el;
    },
    [readOnly, setControlHighlightMode]
  );

  const refreshFromControl = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement) => {
      activeControlRef.current = el;
      updateOverlayFromControl(el);
      if (readOnly) {
        closeMenu();
        return;
      }
      const value = el.value;
      const cursor = el.selectionStart ?? value.length;
      const state = getActiveRemoteDatasourceInterpolation(value, cursor);
      if (!state) {
        closeMenu();
        return;
      }
      const items = remoteDatasourceTemplateSuggestions(state.query, registry);
      if (items.length === 0) {
        closeMenu();
        return;
      }
      const rect = el.getBoundingClientRect();
      interpolationRef.current = { value, openIdx: state.openIdx, cursor };
      setMenu((prev) => {
        const sameList =
          prev &&
          prev.items.length === items.length &&
          prev.items.every((it, i) => it.insert === items[i]?.insert);
        return {
          items,
          highlight: sameList && prev ? Math.min(prev.highlight, items.length - 1) : 0,
          openIdx: state.openIdx,
          cursor,
          rect,
        };
      });
    },
    [readOnly, closeMenu, registry, updateOverlayFromControl]
  );

  const applySuggestion = useCallback(
    (item: TemplateSuggestion) => {
      const root = containerRef.current;
      const el = activeControlRef.current ?? root?.querySelector?.("input, textarea") ?? null;
      if (!isTextControl(el)) return;
      activeControlRef.current = el;

      const liveValue = el.value;
      const snap = interpolationRef.current;
      let openIdx: number;
      let cursor: number;
      if (snap && snap.value === liveValue) {
        openIdx = snap.openIdx;
        cursor = snap.cursor;
      } else {
        const caret = el.selectionStart ?? liveValue.length;
        const state = getActiveRemoteDatasourceInterpolation(liveValue, caret);
        if (!state) {
          closeMenu();
          return;
        }
        openIdx = state.openIdx;
        cursor = caret;
      }

      const next = liveValue.slice(0, openIdx) + item.insert + liveValue.slice(cursor);
      onChange(next);
      closeMenu();

      const pos = openIdx + item.insert.length;
      queueMicrotask(() => {
        const again = activeControlRef.current ?? root?.querySelector?.("input, textarea") ?? null;
        if (!isTextControl(again)) return;
        activeControlRef.current = again;
        again.focus();
        again.setSelectionRange(pos, pos);
        updateOverlayFromControl(again);
      });
    },
    [onChange, closeMenu, updateOverlayFromControl]
  );

  useLayoutEffect(() => {
    if (!menu || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-idx="${menu.highlight}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDocDown = (e: MouseEvent) => {
      const root = containerRef.current;
      const t = e.target;
      if (t instanceof Node && root?.contains(t)) return;
      if (listRef.current?.contains(t as Node)) return;
      closeMenu();
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [menu, closeMenu]);

  useEffect(() => {
    if (!menu) return;
    const onFocusIn = (ev: globalThis.FocusEvent) => {
      const root = containerRef.current;
      const t = ev.target;
      if (t instanceof Node && root?.contains(t)) return;
      if (t instanceof Node && listRef.current?.contains(t)) return;
      closeMenu();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [menu, closeMenu]);

  useEffect(() => {
    if (!menu) return;
    const onScroll = () => {
      const el = activeControlRef.current;
      if (!isTextControl(el)) return;
      const rect = el.getBoundingClientRect();
      setMenu((m) => (m ? { ...m, rect } : null));
      updateOverlayFromControl(el);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [menu, updateOverlayFromControl]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const onScroll = (ev: Event) => {
      const t = ev.target;
      if (!isTextControl(t)) return;
      if (t !== activeControlRef.current) return;
      setOverlay((prev) =>
        prev
          ? {
              ...prev,
              scrollTop: t.scrollTop,
              scrollLeft: t.scrollLeft,
            }
          : prev
      );
    };
    root.addEventListener("scroll", onScroll, true);
    return () => root.removeEventListener("scroll", onScroll, true);
  }, []);

  useEffect(
    () => () => {
      setControlHighlightMode(styledControlRef.current, false);
      styledControlRef.current = null;
    },
    [setControlHighlightMode]
  );

  const onInputCapture = useCallback(
    (e: React.FormEvent) => {
      if (skipSuggestUntilInputRef.current) {
        skipSuggestUntilInputRef.current = false;
      }
      const t = e.target;
      if (!isTextControl(t)) return;
      activeControlRef.current = t;
      refreshFromControl(t);
    },
    [refreshFromControl]
  );

  const onKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      const t = e.target;
      if (!isTextControl(t)) return;
      activeControlRef.current = t;

      if (e.key === "Escape" && menu) {
        e.preventDefault();
        e.stopPropagation();
        skipSuggestUntilInputRef.current = true;
        closeMenu();
        return;
      }

      if (!menu) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setMenu((m) =>
          m ? { ...m, highlight: Math.min(m.highlight + 1, m.items.length - 1) } : m
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setMenu((m) => (m ? { ...m, highlight: Math.max(m.highlight - 1, 0) } : m));
        return;
      }
      if (e.key === "Enter" && menu.items.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const item = menu.items[menu.highlight];
        if (item) applySuggestion(item);
      }
    },
    [menu, closeMenu, applySuggestion]
  );

  const onKeyUpCapture = useCallback(
    (e: React.KeyboardEvent) => {
      if (skipSuggestUntilInputRef.current) return;
      const t = e.target;
      if (!isTextControl(t)) return;
      activeControlRef.current = t;
      refreshFromControl(t);
    },
    [refreshFromControl]
  );

  const onFocusCapture = useCallback(
    (e: React.FocusEvent) => {
      const t = e.target;
      if (!isTextControl(t)) return;
      activeControlRef.current = t;
      refreshFromControl(t);
    },
    [refreshFromControl]
  );

  const onClickCapture = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target;
      if (!isTextControl(t)) return;
      activeControlRef.current = t;
      refreshFromControl(t);
    },
    [refreshFromControl]
  );

  const highlightedSegments = useMemo(
    () => splitTemplateSegments(overlay?.value ?? ""),
    [overlay?.value]
  );

  const portal =
    menu &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={listRef}
        role="listbox"
        aria-label="Datasource templates"
        style={{
          position: "fixed",
          top: menu.rect.bottom + 4,
          left: menu.rect.left,
          minWidth: Math.max(220, menu.rect.width),
          maxHeight: 280,
          overflow: "auto",
          zIndex: 100_000,
          background: "var(--puck-color-grey-11, #fff)",
          border: "1px solid var(--puck-color-grey-09, #e5e7eb)",
          borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          fontSize: 12,
          lineHeight: 1.35,
        }}
      >
        {menu.items.map((item, idx) => (
          <button
            key={item.insert}
            type="button"
            role="option"
            data-idx={idx}
            aria-selected={idx === menu.highlight}
            onMouseEnter={() => setMenu((m) => (m ? { ...m, highlight: idx } : m))}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              applySuggestion(item);
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              border: "none",
              borderBottom: "1px solid var(--puck-color-grey-10, #f3f4f6)",
              background: idx === menu.highlight ? "var(--puck-color-azure-11, #eff6ff)" : "transparent",
              cursor: "pointer",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--puck-color-grey-02, #111)" }}>{item.label}</div>
            {item.description ? (
              <div style={{ marginTop: 2, color: "var(--puck-color-grey-05, #6b7280)", fontFamily: "system-ui" }}>
                {item.description}
              </div>
            ) : null}
          </button>
        ))}
      </div>,
      document.body
    );

  return (
    <>
      <div
        ref={containerRef}
        onInputCapture={onInputCapture}
        onKeyDownCapture={onKeyDownCapture}
        onKeyUpCapture={onKeyUpCapture}
        onFocusCapture={onFocusCapture}
        onClickCapture={onClickCapture}
        style={{ position: "relative" }}
      >
        {overlay ? (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: overlay.rect.top,
              left: overlay.rect.left,
              width: overlay.rect.width,
              height: overlay.rect.height,
              overflow: "hidden",
              pointerEvents: "none",
              zIndex: 1,
              borderRadius: overlay.borderRadius,
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                overflow: "hidden",
                whiteSpace: overlay.whiteSpace,
                font: overlay.font,
                lineHeight: overlay.lineHeight,
                letterSpacing: overlay.letterSpacing,
                paddingTop: overlay.paddingTop,
                paddingRight: overlay.paddingRight,
                paddingBottom: overlay.paddingBottom,
                paddingLeft: overlay.paddingLeft,
                transform: `translate(${-overlay.scrollLeft}px, ${-overlay.scrollTop}px)`,
              }}
            >
              {highlightedSegments.map((segment, idx) => (
                <span
                  key={`${idx}-${segment.text.length}`}
                  style={
                    segment.isTemplate
                      ? {
                          color: "var(--puck-color-azure-03, #1d4ed8)",
                          background: "rgba(37, 99, 235, 0.14)",
                          borderRadius: 3,
                        }
                      : { color: "var(--puck-color-grey-02, #111827)" }
                  }
                >
                  {segment.text}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {children}
      </div>
      {portal}
    </>
  );
}
