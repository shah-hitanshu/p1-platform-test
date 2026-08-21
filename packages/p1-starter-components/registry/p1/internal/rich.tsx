import * as React from "react";

/**
 * Renders the value of a Puck `richtext` field.
 *
 * A `richtext` field's value reaches `render` in one of two shapes:
 *   1. A stored **HTML string** (e.g. "<p>Hello <strong>world</strong></p>")
 *      — when the page is published or the block first mounts.
 *   2. A live **ReactNode** — while the field is being edited inline on the
 *      canvas, Puck hands over its own managed editable node.
 *
 * We render (1) via dangerouslySetInnerHTML and pass (2) straight through, so
 * the same component works both in the editor and on the published page.
 *
 * `className` carries the typographic styling. Because the inner markup is
 * arbitrary HTML, callers style nested elements with Tailwind arbitrary
 * variants (e.g. `[&_h2]:text-3xl`).
 */
export interface RichValueProps {
  value: unknown;
  className?: string;
}

export function RichValue({ value, className }: RichValueProps) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    return <div className={className} dangerouslySetInnerHTML={{ __html: value }} />;
  }
  return <div className={className}>{value as React.ReactNode}</div>;
}

/** Tailwind arbitrary-variant class string that styles arbitrary rich HTML
 *  with the p1-* design tokens. Shared by RichText / Tabs / Accordion. */
export const RICH_PROSE =
  "max-w-prose text-pretty " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&_p]:mb-p1-md [&_p]:leading-relaxed [&_p]:text-p1-text/80 " +
  "[&_h2]:mb-p1-sm [&_h2]:mt-p1-md [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-p1-text md:[&_h2]:text-3xl " +
  "[&_h3]:mb-p1-sm [&_h3]:mt-p1-sm [&_h3]:text-xl [&_h3]:font-bold [&_h3]:tracking-tight [&_h3]:text-p1-text " +
  "[&_ul]:mb-p1-md [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-p1-md [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mb-1 [&_li]:leading-relaxed [&_li]:text-p1-text/80 " +
  "[&_blockquote]:my-p1-md [&_blockquote]:border-l-4 [&_blockquote]:border-p1-warning [&_blockquote]:pl-p1-md [&_blockquote]:font-serif [&_blockquote]:text-xl [&_blockquote]:italic [&_blockquote]:leading-snug [&_blockquote]:text-p1-text " +
  "[&_strong]:font-semibold [&_strong]:text-p1-text [&_em]:italic " +
  "[&_a]:text-p1-primary [&_a]:underline " +
  "[&_mark]:rounded-sm [&_mark]:bg-p1-warning/40 [&_mark]:px-0.5 [&_mark]:text-p1-text " +
  "[&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]";
