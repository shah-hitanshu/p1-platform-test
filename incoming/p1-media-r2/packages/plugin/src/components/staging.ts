// Pure helpers for the media library's staged-upload and edit panels.
// Extracted from media-library.tsx so the two invariants below are unit-testable.
import type { MetadataFieldDef } from "../types";
import type { RowStatus, UploadProgress } from "./upload-flow";

/**
 * Builds the PATCH body for saving edited metadata. `fields` must be the
 * SNAPSHOT taken when the edit began — never the live schema — because the
 * body sends `null` (= clear) for every listed field the user left empty.
 * If the schema fetch resolves mid-edit and grew the field list, iterating
 * the live schema here would null out fields the user never saw or touched.
 */
export function buildPatchBody(
  fields: MetadataFieldDef[],
  row: Array<string | undefined>,
): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  fields.forEach((f, c) => {
    const value = row[c]?.trim();
    body[f.name] = value ? value : null;
  });
  return body;
}

/**
 * Partitions a staged batch after an upload pass: rows whose upload finished
 * (`step === "done"`) are dropped (retrying must never re-POST them — that
 * would create duplicate assets); every other row keeps its position-matched
 * metadata values AND its `UploadProgress`, so a retry resumes from the step
 * that failed instead of restarting the whole presign/PUT/finalize sequence.
 * Rows never attempted (a mid-batch throw) are still "staged" and are kept.
 */
export function keepIncompleteRows<T>(
  rows: T[],
  values: string[][],
  progress: UploadProgress[],
  statuses: RowStatus[],
): { rows: T[]; values: string[][]; progress: UploadProgress[]; statuses: RowStatus[] } {
  const kept: T[] = [];
  const keptValues: string[][] = [];
  const keptProgress: UploadProgress[] = [];
  const keptStatuses: RowStatus[] = [];
  rows.forEach((row, i) => {
    if (statuses[i]?.step === "done") return;
    kept.push(row);
    keptValues.push(values[i] ?? []);
    keptProgress.push(progress[i] ?? {});
    keptStatuses.push(statuses[i] ?? { step: "staged" });
  });
  return { rows: kept, values: keptValues, progress: keptProgress, statuses: keptStatuses };
}
