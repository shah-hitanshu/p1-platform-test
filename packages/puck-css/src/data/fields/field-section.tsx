"use client";

import { type ReactNode } from "react";

interface FieldSectionProps {
  label: string;
  badge?: number;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function FieldSection({
  label,
  badge,
  subtitle,
  defaultOpen = true,
  children,
}: FieldSectionProps) {
  return (
    <details className="p1-field-section" open={defaultOpen || undefined}>
      <summary className="p1-field-section__header">
        <span className="p1-field-section__label">{label}</span>
        {badge != null && (
          <span className="p1-field-section__badge">{badge}</span>
        )}
        <span className="p1-field-section__chevron" aria-hidden="true" />
      </summary>
      {subtitle && (
        <p className="p1-field-section__subtitle">{subtitle}</p>
      )}
      <div className="p1-field-section__body">{children}</div>
    </details>
  );
}
