// Presign -> PUT -> finalize upload sequence, extracted so both the batch
// upload panel and the single-file "Replace image" action share one
// implementation of the 3-step wire protocol.
import { normalizeItem, type MediaItem } from "./media-item";

/** Lifecycle of a single file through the presign -> PUT -> finalize sequence. */
export type UploadStep = "staged" | "presigning" | "uploading" | "finalizing" | "done" | "failed";

export interface RowStatus {
  step: UploadStep;
  error?: string;
}

export const STAGED_STATUS: RowStatus = { step: "staged" };

interface PresignResult {
  assetId: string;
  versionId: string;
  filename: string;
  uploadUrl: string;
}

/**
 * Presign result + PUT outcome for one file, carried across a failed attempt
 * so a retry resumes from the step that failed rather than redoing all
 * three. `presigned` is only kept once `uploaded` is also true — a presigned
 * URL expires after 5 minutes, so re-using one from a failed PUT attempt
 * could just fail again the same way; re-presigning is cheap and safe.
 */
export interface UploadProgress {
  presigned?: PresignResult;
  uploaded?: boolean;
}

export interface UploadTarget {
  workerUrl: string;
  siteId: string;
  workstreamId: string;
  getAuthHeaders: () => Promise<HeadersInit>;
}

/** Thrown on any step failure, carrying how far the upload actually got so the caller can retry from there. */
export class UploadFlowError extends Error {
  progress: UploadProgress;
  constructor(message: string, progress: UploadProgress) {
    super(message);
    this.name = "UploadFlowError";
    this.progress = progress;
  }
}

function targetParams(target: UploadTarget): string {
  return new URLSearchParams({ siteId: target.siteId, workstreamId: target.workstreamId }).toString();
}

async function postJson(target: UploadTarget, path: string, body: unknown): Promise<Response> {
  return fetch(`${target.workerUrl}${path}?${targetParams(target)}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { ...(await target.getAuthHeaders()), "Content-Type": "application/json" },
  });
}

/**
 * Runs the presign -> PUT -> finalize sequence for one file, resuming from
 * `progress` so a retry skips steps that already succeeded. Pass `assetId`
 * to upload a replacement version of an existing asset; omit it to create a
 * new asset. `onStep` fires before each network step so the caller can
 * render live per-row status.
 */
export async function runUpload(
  target: UploadTarget,
  file: File,
  metadata: Record<string, string> | undefined,
  assetId: string | undefined,
  progress: UploadProgress,
  onStep: (step: UploadStep) => void,
): Promise<{ item: MediaItem; progress: UploadProgress }> {
  let presigned = progress.presigned;
  let uploaded = progress.uploaded ?? false;

  if (!uploaded) {
    onStep("presigning");
    const presignPath = assetId ? `/media/${encodeURIComponent(assetId)}/versions/presign` : "/media/presign";
    let presignResponse: Response;
    try {
      presignResponse = await postJson(target, presignPath, {
        filename: file.name,
        contentType: file.type,
        size: file.size,
        metadata,
      });
    } catch (err) {
      throw new UploadFlowError(`Could not reach the server: ${(err as Error).message}`, {});
    }
    if (!presignResponse.ok) throw new UploadFlowError(`Presign failed (${presignResponse.status})`, {});
    const freshlyPresigned: PresignResult = await presignResponse.json();
    presigned = freshlyPresigned;

    onStep("uploading");
    let putResponse: Response;
    try {
      putResponse = await fetch(freshlyPresigned.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
    } catch (err) {
      throw new UploadFlowError(`Upload to storage failed: ${(err as Error).message}`, {});
    }
    if (!putResponse.ok) throw new UploadFlowError(`Upload to storage failed (${putResponse.status})`, {});
    uploaded = true;
  }

  const nextProgress: UploadProgress = { presigned, uploaded };
  const presignedResult = presigned!;

  onStep("finalizing");
  const finalizePath = assetId
    ? `/media/${encodeURIComponent(assetId)}/versions/finalize`
    : "/media/finalize";
  const finalizeBody = assetId
    ? { versionId: presignedResult.versionId, filename: presignedResult.filename }
    : {
        assetId: presignedResult.assetId,
        versionId: presignedResult.versionId,
        filename: presignedResult.filename,
        metadata,
      };
  let finalizeResponse: Response;
  try {
    finalizeResponse = await postJson(target, finalizePath, finalizeBody);
  } catch (err) {
    throw new UploadFlowError(`Could not reach the server: ${(err as Error).message}`, nextProgress);
  }
  if (!finalizeResponse.ok) throw new UploadFlowError(`Finalize failed (${finalizeResponse.status})`, nextProgress);

  const item = normalizeItem(await finalizeResponse.json());
  return { item, progress: nextProgress };
}
