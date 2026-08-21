import * as React from "react";
import "./btn.css";

/**
 * Shared pill button used across blocks (Hero, CTA, Pricing, Lead capture,
 * Feature+Media, Button…). Renders an <a> when `href` is set, else a <span>
 * — matching the static, non-interactive style of the prototype's CanvasButton.
 * Shared utility — not a Puck block.
 */
export type BtnVariant = "primary" | "secondary" | "yellow" | "purple";

export interface BtnProps {
  variant?: BtnVariant;
  href?: string;
  children: React.ReactNode;
  className?: string;
}

function safeHref(h: string): string {
  return /^(https?:\/\/|\/|#)/.test(h) ? h : "#";
}

export function Btn({ variant = "primary", href, children, className = "" }: BtnProps) {
  const cls = ["p1-btn", className].filter(Boolean).join(" ");
  if (href) {
    return (
      <a href={safeHref(href)} className={cls} data-variant={variant}>
        {children}
      </a>
    );
  }
  return (
    <span className={cls} data-variant={variant}>
      {children}
    </span>
  );
}
