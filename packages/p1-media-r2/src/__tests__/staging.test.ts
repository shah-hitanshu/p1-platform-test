import { describe, it, expect } from "vitest";
import { buildPatchBody, keepIncompleteRows } from "../components/staging";
import type { MetadataFieldDef } from "../types";
import type { RowStatus, UploadProgress } from "../components/upload-flow";

const ALT_ONLY: MetadataFieldDef[] = [{ name: "alt", label: "Alt text", type: "string" }];
const FULL: MetadataFieldDef[] = [
  { name: "alt", label: "Alt text", type: "string" },
  { name: "caption", label: "Caption", type: "string" },
  { name: "byline", label: "Byline", type: "string" },
];

describe("buildPatchBody", () => {
  it("sends values for filled cells and null (clear) for emptied ones", () => {
    expect(buildPatchBody(FULL, ["A cat", "", "  "])).toEqual({
      alt: "A cat",
      caption: null,
      byline: null,
    });
  });

  // The schema-race regression: the PATCH body must contain ONLY the fields
  // that were snapshotted when the edit began. If the live schema grows
  // mid-edit (fallback [alt] → fetched [alt, caption, byline]), building from
  // the snapshot must not emit nulls for the new fields — those nulls would
  // clear metadata the user never saw or touched.
  it("never emits fields beyond the given snapshot", () => {
    const body = buildPatchBody(ALT_ONLY, ["A cat"]);
    expect(body).toEqual({ alt: "A cat" });
    expect(Object.keys(body)).not.toContain("caption");
    expect(Object.keys(body)).not.toContain("byline");
  });

  it("trims values and treats a missing cell as a clear", () => {
    expect(buildPatchBody(FULL, ["  spaced  "])).toEqual({
      alt: "spaced",
      caption: null,
      byline: null,
    });
  });
});

describe("keepIncompleteRows", () => {
  const rows = ["a", "b", "c"];
  const values = [["alt-a"], ["alt-b"], ["alt-c"]];
  const progress: UploadProgress[] = [{ uploaded: true }, {}, { uploaded: true }];
  const DONE: RowStatus = { step: "done" };
  const FAILED: RowStatus = { step: "failed", error: "Finalize failed (500)" };
  const STAGED: RowStatus = { step: "staged" };

  // The double-upload regression: a retry must re-POST only the rows that
  // didn't finish — done rows dropped, everything else kept position-matched
  // with its typed values.
  it("drops done rows and keeps the rest position-matched with their values", () => {
    const out = keepIncompleteRows(rows, values, progress, [DONE, FAILED, DONE]);
    expect(out.rows).toEqual(["b"]);
    expect(out.values).toEqual([["alt-b"]]);
  });

  // The resumption contract: a kept row's UploadProgress must survive so a
  // retry can skip presign/PUT once bytes already landed and only redo the
  // step that failed, instead of restarting the whole 3-step sequence.
  it("keeps each retried row's UploadProgress alongside it", () => {
    const withProgress: UploadProgress[] = [{}, { presigned: undefined, uploaded: true }, {}];
    const out = keepIncompleteRows(rows, values, withProgress, [FAILED, FAILED, DONE]);
    expect(out.rows).toEqual(["a", "b"]);
    expect(out.progress).toEqual([{}, { presigned: undefined, uploaded: true }]);
  });

  it("keeps everything when nothing finished (mid-batch throw: unattempted rows stay staged)", () => {
    const out = keepIncompleteRows(rows, values, progress, [STAGED, STAGED, STAGED]);
    expect(out.rows).toEqual(rows);
    expect(out.values).toEqual(values);
  });

  it("keeps nothing when everything finished", () => {
    const out = keepIncompleteRows(rows, values, progress, [DONE, DONE, DONE]);
    expect(out.rows).toEqual([]);
    expect(out.values).toEqual([]);
  });

  it("substitutes an empty row/progress for missing values", () => {
    const out = keepIncompleteRows(rows, [["alt-a"]], [], [FAILED, FAILED, DONE]);
    expect(out.values).toEqual([["alt-a"], []]);
    expect(out.progress).toEqual([{}, {}]);
  });
});
