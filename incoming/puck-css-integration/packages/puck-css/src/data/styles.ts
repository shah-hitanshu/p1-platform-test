"use client";

/* ── shared style tokens for p1-client UI ── */

export const mono = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const muted = {
  color: "var(--puck-color-grey-04, #6b7280)",
  fontSize: 12,
} as const;

export const card = {
  border: "1px solid var(--puck-color-grey-09, #e5e7eb)",
  borderRadius: 8,
} as const;

export const infoPanel = {
  ...card,
  marginBottom: 16,
  padding: 12,
  border: "1px solid var(--puck-color-azure-08, #bfdbfe)",
  background: "var(--puck-color-azure-11, #eff6ff)",
} as const;

export const sectionLabel = {
  ...muted,
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

export const errorText = {
  color: "var(--puck-color-rose-04, #be123c)",
  margin: 0,
} as const;

export const backdrop = {
  position: "fixed" as const,
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  zIndex: 100000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
} as const;

export const modalPanel = {
  background: "var(--puck-color-white, #fff)",
  borderRadius: 12,
  maxWidth: 720,
  width: "100%",
  maxHeight: "90vh",
  overflow: "hidden" as const,
  display: "flex",
  flexDirection: "column" as const,
  boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
} as const;

/* ── button variants ── */

const buttonBase = {
  borderRadius: 4,
  fontSize: 13,
  cursor: "pointer",
} as const;

export const primaryButton = {
  ...buttonBase,
  padding: "6px 12px",
  border: "none",
  background: "var(--puck-color-azure-04, #2563eb)",
  color: "#fff",
} as const;

export const secondaryButton = {
  ...buttonBase,
  padding: "6px 12px",
  border: "1px solid var(--puck-color-grey-09, #e5e7eb)",
  background: "var(--puck-color-grey-11, #f9fafb)",
  color: "inherit",
} as const;

export const dangerButton = {
  ...buttonBase,
  padding: "4px 10px",
  color: "#b91c1c",
  background: "#fef2f2",
  border: "1px solid #fecaca",
} as const;

export const ghostButton = {
  ...buttonBase,
  padding: "4px 8px",
  border: "none",
  background: "transparent",
  color: "var(--puck-color-grey-04, #6b7280)",
} as const;
