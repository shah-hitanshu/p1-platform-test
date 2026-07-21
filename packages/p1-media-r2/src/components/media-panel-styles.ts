import type { CSSProperties } from "react";

// Shared inline styles for the library's upload-details and edit panels.

export function primaryBtnStyle(uploading: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    backgroundColor: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: uploading ? "not-allowed" : "pointer",
    opacity: uploading ? 0.6 : 1,
    fontFamily: "inherit",
  };
}

export function secondaryBtnStyle(uploading: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    backgroundColor: "white",
    color: "#666",
    border: "1px solid #d0d0d0",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: uploading ? "not-allowed" : "pointer",
    fontFamily: "inherit",
  };
}

export const panelErrorStyle: CSSProperties = {
  color: "#b91c1c",
  fontSize: "12px",
  marginTop: "8px",
};

export const panelHeadingStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  color: "#333",
  marginBottom: "4px",
};

export const panelButtonRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "8px",
  marginTop: "16px",
};
