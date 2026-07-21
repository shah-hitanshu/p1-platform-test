import { describe, it, expect } from "vitest";
import { parseDelimited, detectHeader, applyDelimited } from "../delimited";
import type { MetadataFieldDef } from "../types";

const FIELDS: MetadataFieldDef[] = [
  { name: "alt", label: "Alt text", type: "string" },
  { name: "caption", label: "Caption", type: "string" },
  { name: "credit", label: "Credit", type: "string" },
  { name: "byline", label: "Byline", type: "string" },
];

const LABELS = ["a.png", "b.png", "c.png"];
const empty = () => LABELS.map(() => FIELDS.map(() => ""));

describe("parseDelimited", () => {
  it("parses TSV when any tab is present (spreadsheet clipboard)", () => {
    expect(parseDelimited("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("parses CSV with quoted fields, embedded commas/newlines and \"\" escapes", () => {
    expect(parseDelimited('a,"hello, world","line1\nline2","say ""hi"""')).toEqual([
      ["a", "hello, world", "line1\nline2", 'say "hi"'],
    ]);
  });

  it("handles CRLF rows and drops trailing-newline artifacts", () => {
    expect(parseDelimited("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("prefers tab over comma so commas survive inside TSV cells", () => {
    expect(parseDelimited("hello, world\tb")).toEqual([["hello, world", "b"]]);
  });
});

describe("detectHeader", () => {
  it("matches field names, labels (case-insensitive) and filename columns", () => {
    expect(detectHeader(["filename", "ALT", "Caption"], FIELDS)).toEqual(["filename", 0, 1]);
  });

  it("rejects a row with any unknown non-empty cell (it's data, not a header)", () => {
    expect(detectHeader(["A red barn", "caption"], FIELDS)).toBeNull();
  });

  it("rejects an all-empty row", () => {
    expect(detectHeader(["", ""], FIELDS)).toBeNull();
  });
});

describe("applyDelimited", () => {
  it("returns null for a plain single value (default paste should proceed)", () => {
    expect(
      applyDelimited({ text: "hello", fields: FIELDS, rowLabels: LABELS, current: empty(), anchorRow: 0, anchorCol: 0 }),
    ).toBeNull();
  });

  it("returns null for a single-line comma string — prose, not CSV", () => {
    expect(
      applyDelimited({ text: "hello, world", fields: FIELDS, rowLabels: LABELS, current: empty(), anchorRow: 0, anchorCol: 0 }),
    ).toBeNull();
  });

  it("fills a single-line TSV across columns from the anchor", () => {
    const next = applyDelimited({
      text: "alt one\tcap one",
      fields: FIELDS,
      rowLabels: LABELS,
      current: empty(),
      anchorRow: 1,
      anchorCol: 0,
    })!;
    expect(next[1]).toEqual(["alt one", "cap one", "", ""]);
    expect(next[0]).toEqual(["", "", "", ""]);
  });

  it("fills multi-row data down/right from the anchor cell, clamped to the grid", () => {
    const next = applyDelimited({
      text: "x1\tx2\ny1\ty2\nz1\tz2\nw1\tw2", // 4 rows into a 3-row grid, anchored at row 1
      fields: FIELDS,
      rowLabels: LABELS,
      current: empty(),
      anchorRow: 1,
      anchorCol: 3, // last column — second pasted column falls off the grid
      })!;
    expect(next[1]).toEqual(["", "", "", "x1"]);
    expect(next[2]).toEqual(["", "", "", "y1"]);
    expect(next).toHaveLength(3);
  });

  it("maps columns by header row and ignores the anchor", () => {
    const next = applyDelimited({
      text: "caption,alt\ncap a,alt a\ncap b,alt b",
      fields: FIELDS,
      rowLabels: LABELS,
      current: empty(),
      anchorRow: 2,
      anchorCol: 3,
    })!;
    expect(next[0]).toEqual(["alt a", "cap a", "", ""]);
    expect(next[1]).toEqual(["alt b", "cap b", "", ""]);
  });

  it("matches rows by filename column, skipping unknown filenames", () => {
    const next = applyDelimited({
      text: "filename\talt\nc.png\talt c\nmissing.png\tnope\nA.PNG\talt a",
      fields: FIELDS,
      rowLabels: LABELS,
      current: empty(),
      anchorRow: 0,
      anchorCol: 0,
    })!;
    expect(next[2][0]).toBe("alt c");
    expect(next[0][0]).toBe("alt a"); // case-insensitive filename match
    expect(next[1]).toEqual(["", "", "", ""]);
  });

  it("does not mutate the current values", () => {
    const current = empty();
    applyDelimited({
      text: "a\tb\nc\td",
      fields: FIELDS,
      rowLabels: LABELS,
      current,
      anchorRow: 0,
      anchorCol: 0,
    });
    expect(current).toEqual(empty());
  });
});
