import { describe, it, expect } from "vitest";
import {
  makeMediaValue,
  isMediaValue,
  buildValueFromAsset,
  applyCropToValue,
  applyTrimToValue,
  setMetaOnValue,
} from "../media-value";
import type { MediaValue } from "../types";

describe("makeMediaValue (R10 identity invariant)", () => {
  const full = {
    assetId: "asset-1",
    versionId: "ver-1",
    url: "https://cdn.example.com/a.jpg?fit=cover&gravity=auto",
  };

  it("builds a MediaValue when both assetId and versionId are present", () => {
    const v = makeMediaValue(full);
    expect(isMediaValue(v)).toBe(true);
    const obj = v as MediaValue;
    expect(obj.assetId).toBe("asset-1");
    expect(obj.versionId).toBe("ver-1");
    expect(obj.url).toBe(full.url);
  });

  // Intent: a value with undefined identity is unfindable by "update usages"
  // and can render src=undefined, so the field MUST fall back to a string.
  it("falls back to a bare URL string when assetId is missing", () => {
    const v = makeMediaValue({ versionId: "ver-1", url: full.url });
    expect(v).toBe(full.url);
    expect(isMediaValue(v)).toBe(false);
  });

  it("falls back to a bare URL string when versionId is missing", () => {
    const v = makeMediaValue({ assetId: "asset-1", url: full.url });
    expect(v).toBe(full.url);
  });

  it("treats an empty-string id as absent identity (still falls back)", () => {
    expect(makeMediaValue({ assetId: "", versionId: "ver-1", url: full.url })).toBe(full.url);
    expect(makeMediaValue({ assetId: "asset-1", versionId: "", url: full.url })).toBe(full.url);
    expect(makeMediaValue({ assetId: null, versionId: null, url: full.url })).toBe(full.url);
  });

  it("stamps metaSchemaVersion only when it is a number", () => {
    const v = makeMediaValue({ ...full, metaSchemaVersion: 3 }) as MediaValue;
    expect(v.metaSchemaVersion).toBe(3);
    const noVer = makeMediaValue(full) as MediaValue;
    expect("metaSchemaVersion" in noVer).toBe(false);
  });

  it("copies metadata defaults, skipping empty and undefined values", () => {
    const v = makeMediaValue({
      ...full,
      metadata: { alt: "A cat", byline: "Jane", caption: "", location: undefined },
    }) as MediaValue;
    expect(v.alt).toBe("A cat");
    expect(v.byline).toBe("Jane");
    expect("caption" in v).toBe(false);
    expect("location" in v).toBe(false);
  });

  it("never lets metadata clobber identity fields", () => {
    const v = makeMediaValue({
      ...full,
      metadata: { assetId: "evil", versionId: "evil", url: "https://evil/x" },
    }) as MediaValue;
    expect(v.assetId).toBe("asset-1");
    expect(v.versionId).toBe("ver-1");
    expect(v.url).toBe(full.url);
  });
});

describe("isMediaValue", () => {
  it("is true for objects, false for strings and null", () => {
    expect(isMediaValue({ assetId: "a", versionId: "v", url: "u" })).toBe(true);
    expect(isMediaValue("https://cdn/x.jpg")).toBe(false);
    expect(isMediaValue(null)).toBe(false);
    expect(isMediaValue(undefined)).toBe(false);
  });
});

describe("buildValueFromAsset (select write-path)", () => {
  const CDN_URL = "https://cdn.example.com/site/assets/a/v-photo.jpg";

  // Concern #1: captured dimensions must flow into the stored value (CLS win).
  it("copies width/height and flat metadata, and applies the crop", () => {
    const v = buildValueFromAsset(
      {
        assetId: "asset-1",
        versionId: "ver-1",
        url: `${CDN_URL}?stale=1`,
        width: 800,
        height: 600,
        metadata: { alt: "A cat", byline: "Jane" },
        metaSchemaVersion: 2,
      },
      "smart",
    ) as MediaValue;
    expect(v.width).toBe(800);
    expect(v.height).toBe(600);
    expect(v.alt).toBe("A cat");
    expect(v.byline).toBe("Jane");
    expect(v.metaSchemaVersion).toBe(2);
    expect(v.url).toBe(`${CDN_URL}?fit=cover&gravity=auto`);
  });

  // R10: a pre-cutover asset with no identity yields a string, not a partial object.
  // A stale trim rect from the previous image must never carry onto a newly
  // selected asset — "custom" degrades to fit-in at this write path.
  it("degrades a carried 'custom' mode to fit-in on new-asset selection", () => {
    const v = buildValueFromAsset(
      { assetId: "a", versionId: "v", url: `${CDN_URL}?trim.left=1&trim.top=2&trim.width=3&trim.height=4` },
      "custom",
    ) as MediaValue;
    expect(v.url).toBe(`${CDN_URL}?fit=scale-down`);
  });

  it("falls back to a string when the asset has no identity", () => {
    const v = buildValueFromAsset({ url: CDN_URL, width: 800 }, "fit");
    expect(typeof v).toBe("string");
    expect(v).toBe(`${CDN_URL}?fit=scale-down`);
  });
});

describe("applyCropToValue (crop write-path, R10)", () => {
  const CDN_URL = "https://cdn.example.com/x.jpg";

  it("keeps a legacy string a string — never a partial-identity object", () => {
    const out = applyCropToValue(CDN_URL, "smart");
    expect(typeof out).toBe("string");
    expect(out).toBe(`${CDN_URL}?fit=cover&gravity=auto`);
  });

  it("updates a MediaValue's url while preserving identity", () => {
    const value: MediaValue = { assetId: "a", versionId: "v", url: `${CDN_URL}?fit=scale-down`, alt: "cat" };
    const out = applyCropToValue(value, "smart") as MediaValue;
    expect(out.assetId).toBe("a");
    expect(out.versionId).toBe("v");
    expect(out.alt).toBe("cat");
    expect(out.url).toBe(`${CDN_URL}?fit=cover&gravity=auto`);
  });

  it("leaves an empty value unchanged", () => {
    expect(applyCropToValue("", "smart")).toBe("");
  });
});

describe("applyTrimToValue (manual crop write-path, R10)", () => {
  const CDN_URL = "https://cdn.example.com/x.jpg";
  const RECT = { left: 10, top: 20, width: 300, height: 200 };
  const TRIMMED = `${CDN_URL}?trim.left=10&trim.top=20&trim.width=300&trim.height=200`;

  it("keeps a legacy string a string — never a partial-identity object", () => {
    const out = applyTrimToValue(CDN_URL, RECT);
    expect(typeof out).toBe("string");
    expect(out).toBe(TRIMMED);
  });

  it("updates a MediaValue's url while preserving identity, replacing preset crop", () => {
    const value: MediaValue = { assetId: "a", versionId: "v", url: `${CDN_URL}?fit=cover&gravity=auto`, alt: "cat" };
    const out = applyTrimToValue(value, RECT) as MediaValue;
    expect(out.assetId).toBe("a");
    expect(out.versionId).toBe("v");
    expect(out.alt).toBe("cat");
    expect(out.url).toBe(TRIMMED);
  });

  it("leaves an empty value unchanged", () => {
    expect(applyTrimToValue("", RECT)).toBe("");
  });
});

describe("setMetaOnValue (metadata write-path, R10 + identity guard)", () => {
  const value: MediaValue = { assetId: "a", versionId: "v", url: "https://cdn/x.jpg" };

  it("never attaches metadata to a legacy string (stays a string)", () => {
    const out = setMetaOnValue("https://cdn/x.jpg", "alt", "hi");
    expect(out).toBe("https://cdn/x.jpg");
  });

  it("sets a metadata field on a MediaValue", () => {
    const out = setMetaOnValue(value, "alt", "A cat") as MediaValue;
    expect(out.alt).toBe("A cat");
    expect(out.assetId).toBe("a");
  });

  // Concern #2: a schema field named like an identity key must not clobber it.
  it("refuses to overwrite structural identity keys", () => {
    for (const key of ["assetId", "versionId", "url", "metaSchemaVersion"]) {
      const out = setMetaOnValue(value, key, "evil") as MediaValue;
      expect(out).toEqual(value); // unchanged
    }
  });
});
