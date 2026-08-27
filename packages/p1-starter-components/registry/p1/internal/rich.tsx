import * as React from "react";
import "./rich.css";
import { sanitizeRichtextHtml } from "@/registry/p1/internal/sanitize-richtext";

/**
 * Renders the value of a Puck `richtext` field.
 *
 * A `richtext` field's value reaches `render` in one of two shapes:
 *   1. A stored **HTML string** — when the page is published or first mounts.
 *   2. A live **ReactNode** — while being edited inline on the Puck canvas.
 *
 * Strings are sanitized before rendering; ReactNodes pass through unchanged.
 */
export interface RichValueProps {
  value: unknown;
  className?: string;
}

export function RichValue({ value, className }: RichValueProps) {
  const cls = ["p1-rich", className].filter(Boolean).join(" ");
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    return <div className={cls} dangerouslySetInnerHTML={{ __html: sanitizeRichtextHtml(value) }} />;
  }
  return <div className={cls}>{value as React.ReactNode}</div>;
}
