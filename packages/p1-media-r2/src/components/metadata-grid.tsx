"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { applyDelimited } from "../delimited";
import type { MetadataFieldDef } from "../types";

export interface MetadataGridRow {
  key: string;
  /** Shown in the row header and used for header-mode paste matching (filename). */
  label: string;
  thumbnailUrl?: string;
  /** Small status badge under the filename (e.g. upload progress/failure). */
  status?: { text: string; isError?: boolean };
}

/**
 * Keyboard-accessible metadata entry grid: one row per image, one column per
 * schema field. Tab moves through cells in DOM order; Enter/ArrowDown and
 * ArrowUp move within a column (inputs are single-line, so vertical arrows are
 * free). Pasting multi-cell TSV/CSV fills from the focused cell — or maps by
 * header row / filename column when present (see applyDelimited).
 */
export function MetadataGrid(props: {
  fields: MetadataFieldDef[];
  rows: MetadataGridRow[];
  /** `rows.length` x `fields.length` current values. */
  values: string[][];
  onChange: (next: string[][]) => void;
  disabled?: boolean;
  /** Focus the first cell when the grid mounts. */
  autoFocus?: boolean;
}): ReactElement {
  const { fields, rows, values, onChange, disabled, autoFocus } = props;
  const inputRefs = useRef<Array<Array<HTMLInputElement | null>>>([]);
  inputRefs.current = rows.map((_, r) => inputRefs.current[r] ?? []);

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCell = (r: number, c: number, v: string) => {
    const next = values.map((row) => [...row]);
    next[r][c] = v;
    onChange(next);
  };

  const focusCell = (r: number, c: number) => {
    inputRefs.current[r]?.[c]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(Math.min(r + 1, rows.length - 1), c);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(Math.max(r - 1, 0), c);
    }
  };

  const handlePaste = (e: React.ClipboardEvent, r: number, c: number) => {
    const text = e.clipboardData.getData("text/plain");
    const next = applyDelimited({
      text,
      fields,
      rowLabels: rows.map((row) => row.label),
      current: values,
      anchorRow: r,
      anchorCol: c,
    });
    if (next) {
      e.preventDefault();
      onChange(next);
    }
    // null → plain value; let the browser paste into the cell normally
  };

  const cellInputStyle: React.CSSProperties = {
    width: "100%",
    minWidth: "110px",
    padding: "5px 7px",
    border: "1px solid #d0d0d0",
    borderRadius: "4px",
    fontSize: "13px",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
  };

  const thStyle: React.CSSProperties = {
    textAlign: "left",
    fontSize: "11px",
    fontWeight: 600,
    color: "#666",
    padding: "4px 6px",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        role="grid"
        aria-label="Image metadata"
        style={{ borderCollapse: "separate", borderSpacing: "4px", width: "100%" }}
      >
        <thead>
          <tr>
            <th style={thStyle} scope="col">
              File
            </th>
            {fields.map((f) => (
              <th key={f.name} style={thStyle} scope="col">
                {f.label}
                {f.required ? " *" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.key}>
              <th
                scope="row"
                style={{
                  ...thStyle,
                  fontWeight: 500,
                  color: "#444",
                  maxWidth: "180px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {row.thumbnailUrl && (
                    <img
                      src={row.thumbnailUrl}
                      alt=""
                      style={{
                        width: "32px",
                        height: "32px",
                        objectFit: "cover",
                        borderRadius: "4px",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ overflow: "hidden" }}>
                    <span
                      title={row.label}
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "140px",
                      }}
                    >
                      {row.label}
                    </span>
                    {row.status && (
                      <span
                        style={{
                          display: "block",
                          fontSize: "11px",
                          fontWeight: 400,
                          color: row.status.isError ? "#c0392b" : "#888",
                        }}
                      >
                        {row.status.text}
                      </span>
                    )}
                  </div>
                </div>
              </th>
              {fields.map((f, c) => (
                <td key={f.name} style={{ padding: 0 }}>
                  <input
                    ref={(el) => {
                      inputRefs.current[r][c] = el;
                    }}
                    type="text"
                    value={values[r]?.[c] ?? ""}
                    disabled={disabled}
                    aria-label={`${f.label} for ${row.label}`}
                    onChange={(e) => setCell(r, c, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, r, c)}
                    onPaste={(e) => handlePaste(e, r, c)}
                    style={{ ...cellInputStyle, opacity: disabled ? 0.6 : 1 }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
