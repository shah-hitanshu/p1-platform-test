"use client";

import { isValidElement, useEffect, useState, useRef, type ReactNode } from "react";
import {
  useResolvedPreviewState,
  getBlockPropsById,
} from "@pantheon-systems/puck-css";
import { sanitizeRichtextHtml } from "./sanitize-richtext";

const TEMPLATE_TOKEN_RE = /\{\{[^{}]+\}\}/;

function extractRawText(element: ReactNode): string | null {
  if (!isValidElement(element)) return null;
  const props = element.props as Record<string, unknown>;
  return typeof props.value === "string" ? props.value : null;
}

export function ParagraphEditorText({
  text,
  id,
}: {
  text: ReactNode;
  id: string;
}) {
  const { data: resolved } = useResolvedPreviewState();
  const [isFocused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const rawText = extractRawText(text);
  const hasTemplates = rawText != null && TEMPLATE_TOKEN_RE.test(rawText);

  const resolvedProps = resolved ? getBlockPropsById(resolved, id) : null;
  const resolvedText =
    typeof resolvedProps?.text === "string" ? resolvedProps.text : null;

  const showResolved = hasTemplates && !isFocused && resolvedText != null;

  if (!hasTemplates) return <>{text}</>;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative" }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setFocused(false);
        }
      }}
    >
      <div style={showResolved ? { color: "transparent" } : undefined}>
        {text}
      </div>
      {showResolved && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            pointerEvents: "none",
          }}
        >
          <div
            className="prose max-w-prose"
            dangerouslySetInnerHTML={{
              __html: sanitizeRichtextHtml(resolvedText),
            }}
          />
        </div>
      )}
    </div>
  );
}
