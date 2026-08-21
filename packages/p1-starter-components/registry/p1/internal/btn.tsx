import * as React from "react";

/**
 * Shared pill button used across blocks (Hero, CTA, Pricing, Lead capture,
 * Feature+Media, Button…). Renders an <a> when `href` is set, else a <span>
 * — matching the static, non-interactive style of the prototype's CanvasButton.
 * Shared utility — not a Puck block.
 */
export type BtnVariant = "primary" | "secondary" | "yellow" | "purple";

const VARIANT: Record<BtnVariant, string> = {
  primary: "bg-gray-900 text-white",
  secondary: "border border-p1-border bg-white text-p1-text",
  yellow: "bg-p1-warning text-p1-text",
  purple: "bg-p1-primary text-white",
};

export interface BtnProps {
  variant?: BtnVariant;
  href?: string;
  children: React.ReactNode;
  className?: string;
}

export function Btn({ variant = "primary", href, children, className = "" }: BtnProps) {
  const cls = `inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold no-underline transition-opacity hover:opacity-90 ${VARIANT[variant]} ${className}`;
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return <span className={cls}>{children}</span>;
}
