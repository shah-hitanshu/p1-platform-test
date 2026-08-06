// Delimited-text (TSV/CSV) paste support for the upload metadata grid.
// Pure functions — all grid-fill decisions live here so they are unit-testable.
import type { MetadataFieldDef } from "./types";

/** RFC-4180-ish parse: quoted fields, "" escapes, CRLF/LF rows. */
function parseWithDelimiter(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Trailing newline artifacts
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

/**
 * Parses clipboard text as TSV when it contains any tab (what spreadsheets
 * put on the clipboard), CSV otherwise.
 */
export function parseDelimited(text: string): string[][] {
  if (!text) return [];
  return parseWithDelimiter(text, text.includes("\t") ? "\t" : ",");
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

const FILENAME_HEADERS = new Set(["filename", "file", "name"]);

/**
 * A header row is one whose every non-empty cell names a schema field (by
 * `name` or `label`, case-insensitive) or a filename column. Returns the
 * column mapping (field index per column, -1 = ignore, "filename" for the
 * match column), or null when the row is not a header.
 */
export function detectHeader(
  row: string[],
  fields: MetadataFieldDef[],
): (number | "filename")[] | null {
  let matched = 0;
  const mapping: (number | "filename")[] = row.map(() => -1);
  for (let c = 0; c < row.length; c++) {
    const cell = norm(row[c]);
    if (cell === "") continue;
    if (FILENAME_HEADERS.has(cell)) {
      mapping[c] = "filename";
      matched++;
      continue;
    }
    const idx = fields.findIndex((f) => norm(f.name) === cell || norm(f.label) === cell);
    if (idx === -1) return null; // a non-empty cell that isn't a known column
    mapping[c] = idx;
    matched++;
  }
  return matched > 0 ? mapping : null;
}

export interface ApplyDelimitedOptions {
  /** Raw clipboard text. */
  text: string;
  /** Grid columns, in display order. */
  fields: MetadataFieldDef[];
  /** One label (filename) per grid row, for header-mode row matching. */
  rowLabels: string[];
  /** Current grid values, `rowLabels.length` x `fields.length`. */
  current: string[][];
  /** Cell the paste landed on. */
  anchorRow: number;
  anchorCol: number;
}

/**
 * Applies pasted delimited text to the grid, returning the next values or
 * `null` when the text is not grid-shaped (a plain single value — the caller
 * should let the browser's default paste happen).
 *
 * - With a header row (cells matching field names/labels, optionally a
 *   filename column): columns map by header; rows match by filename when that
 *   column is present, else top-to-bottom from row 0. The anchor is ignored,
 *   so a whole exported sheet can be pasted into any cell.
 * - Without a header: values fill right/down from the anchor cell,
 *   spreadsheet-style, clamped to the grid.
 * - A single-line comma-containing string is treated as prose, not CSV; a
 *   single line is only grid-shaped when tab-delimited.
 */
export function applyDelimited(opts: ApplyDelimitedOptions): string[][] | null {
  const { text, fields, rowLabels, current, anchorRow, anchorCol } = opts;
  const parsed = parseDelimited(text);
  if (parsed.length === 0) return null;
  const multiCell =
    parsed.length > 1 || (parsed[0].length > 1 && text.includes("\t"));
  if (!multiCell) return null;

  const next = current.map((r) => [...r]);

  const header = detectHeader(parsed[0], fields);
  if (header && parsed.length > 1) {
    const dataRows = parsed.slice(1);
    const filenameCol = header.indexOf("filename");
    for (let i = 0; i < dataRows.length; i++) {
      let targetRow: number;
      if (filenameCol !== -1) {
        const wanted = norm(dataRows[i][filenameCol] ?? "");
        targetRow = rowLabels.findIndex((l) => norm(l) === wanted);
        if (targetRow === -1) continue; // no matching upload — skip the row
      } else {
        targetRow = i;
        if (targetRow >= next.length) break;
      }
      for (let c = 0; c < dataRows[i].length; c++) {
        const fieldIdx = header[c];
        if (typeof fieldIdx !== "number" || fieldIdx < 0) continue;
        next[targetRow][fieldIdx] = dataRows[i][c] ?? "";
      }
    }
    return next;
  }

  // Anchor-relative fill, clamped to the grid.
  for (let r = 0; r < parsed.length; r++) {
    const targetRow = anchorRow + r;
    if (targetRow >= next.length) break;
    for (let c = 0; c < parsed[r].length; c++) {
      const targetCol = anchorCol + c;
      if (targetCol >= fields.length) break;
      next[targetRow][targetCol] = parsed[r][c];
    }
  }
  return next;
}
