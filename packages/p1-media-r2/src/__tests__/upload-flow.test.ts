import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runUpload, UploadFlowError, type UploadTarget } from "../components/upload-flow";

const TARGET: UploadTarget = {
  workerUrl: "https://worker.example.com",
  siteId: "site-1",
  workstreamId: "default",
  getAuthHeaders: async () => ({ Authorization: "Bearer test-token" }),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeFile(name = "photo.png", type = "image/png"): File {
  return new File(["bytes"], name, { type });
}

const PRESIGN_RESULT = {
  assetId: "asset-1",
  versionId: "version-1",
  filename: "photo.png",
  uploadUrl: "https://r2.example.com/signed-put-url",
  expiresAt: "2026-01-01T00:05:00.000Z",
};

const FINALIZED_ASSET = {
  assetId: "asset-1",
  versionId: "version-1",
  url: "https://cdn.example.com/asset-1.png",
  filename: "photo.png",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runUpload — new asset", () => {
  it("presigns, PUTs the bytes, then finalizes, returning the normalized item and resulting progress", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(PRESIGN_RESULT))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(FINALIZED_ASSET, 201));

    const steps: string[] = [];
    const result = await runUpload(TARGET, makeFile(), { alt: "A cat" }, undefined, {}, (s) => steps.push(s));

    expect(steps).toEqual(["presigning", "uploading", "finalizing"]);
    expect(result.item).toEqual({
      assetId: "asset-1",
      versionId: "version-1",
      url: "https://cdn.example.com/asset-1.png",
      filename: "photo.png",
      contentType: undefined,
      size: undefined,
      width: undefined,
      height: undefined,
      metadata: undefined,
      metaSchemaVersion: undefined,
      createdAt: undefined,
    });
    expect(result.progress).toEqual({ presigned: PRESIGN_RESULT, uploaded: true });

    // Call 1: presign, hits the new-asset endpoint with the declared file facts.
    const [presignUrl, presignInit] = fetchMock.mock.calls[0];
    expect(String(presignUrl)).toBe("https://worker.example.com/media/presign?siteId=site-1&workstreamId=default");
    expect(JSON.parse(presignInit.body)).toEqual({
      filename: "photo.png",
      contentType: "image/png",
      size: 5,
      metadata: { alt: "A cat" },
    });
    expect(presignInit.headers.Authorization).toBe("Bearer test-token");

    // Call 2: bare PUT to the signed URL — no Authorization header.
    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(PRESIGN_RESULT.uploadUrl);
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers.Authorization).toBeUndefined();
    expect(putInit.headers["Content-Type"]).toBe("image/png");

    // Call 3: finalize, resends the presign identity plus the same metadata.
    const [finalizeUrl, finalizeInit] = fetchMock.mock.calls[2];
    expect(String(finalizeUrl)).toBe("https://worker.example.com/media/finalize?siteId=site-1&workstreamId=default");
    expect(JSON.parse(finalizeInit.body)).toEqual({
      assetId: "asset-1",
      versionId: "version-1",
      filename: "photo.png",
      metadata: { alt: "A cat" },
    });
  });

  it("resumes from a prior successful upload: skips presign and PUT, only retries finalize", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(FINALIZED_ASSET, 201));

    const steps: string[] = [];
    const result = await runUpload(
      TARGET,
      makeFile(),
      { alt: "A cat" },
      undefined,
      { presigned: PRESIGN_RESULT, uploaded: true },
      (s) => steps.push(s),
    );

    expect(steps).toEqual(["finalizing"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.progress).toEqual({ presigned: PRESIGN_RESULT, uploaded: true });
  });

  it("throws UploadFlowError with empty progress when the PUT fails, so a retry re-presigns rather than reusing a possibly-expired URL", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(PRESIGN_RESULT))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(runUpload(TARGET, makeFile(), undefined, undefined, {}, () => {})).rejects.toMatchObject({
      name: "UploadFlowError",
      progress: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // never reaches finalize
  });

  it("throws UploadFlowError carrying uploaded:true when finalize fails after a successful PUT, so a retry skips presign+PUT", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(PRESIGN_RESULT))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    let caught: unknown;
    try {
      await runUpload(TARGET, makeFile(), undefined, undefined, {}, () => {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UploadFlowError);
    expect((caught as InstanceType<typeof UploadFlowError>).progress).toEqual({
      presigned: PRESIGN_RESULT,
      uploaded: true,
    });
  });
});

describe("runUpload — workstreamId omitted", () => {
  it("omits workstreamId from the query string entirely rather than sending it empty/undefined", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(PRESIGN_RESULT))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(FINALIZED_ASSET, 201));

    const targetWithoutWorkstream: UploadTarget = {
      workerUrl: "https://worker.example.com",
      siteId: "site-1",
      getAuthHeaders: async () => ({ Authorization: "Bearer test-token" }),
    };
    await runUpload(targetWithoutWorkstream, makeFile(), undefined, undefined, {}, () => {});

    const [presignUrl] = fetchMock.mock.calls[0];
    expect(String(presignUrl)).toBe("https://worker.example.com/media/presign?siteId=site-1");
  });
});

describe("runUpload — replace version", () => {
  it("hits the versions presign/finalize endpoints and omits metadata (a replace never touches metadata)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(PRESIGN_RESULT))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(FINALIZED_ASSET, 201));

    await runUpload(TARGET, makeFile(), undefined, "asset-1", {}, () => {});

    const [presignUrl, presignInit] = fetchMock.mock.calls[0];
    expect(String(presignUrl)).toBe(
      "https://worker.example.com/media/asset-1/versions/presign?siteId=site-1&workstreamId=default",
    );
    expect(JSON.parse(presignInit.body).metadata).toBeUndefined();

    const [finalizeUrl, finalizeInit] = fetchMock.mock.calls[2];
    expect(String(finalizeUrl)).toBe(
      "https://worker.example.com/media/asset-1/versions/finalize?siteId=site-1&workstreamId=default",
    );
    // No assetId in the body — the versions/finalize endpoint takes it from the URL.
    expect(JSON.parse(finalizeInit.body)).toEqual({ versionId: "version-1", filename: "photo.png" });
  });
});
