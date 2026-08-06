import { describe, it, expect } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { getMediaProps, MediaImage, MediaFigure } from "../render";
import type { MediaValue, MetadataFieldDef } from "../types";

const CDN = "https://staging.media.p1.pantheon.io";
const CDN_URL = `${CDN}/site/assets/a/v-photo.jpg`;

// --- element-tree inspection ---------------------------------------------
// react-dom is intentionally absent from this package (installing it would
// purge the shared workspace node_modules), so we inspect the element tree a
// component returns rather than render it to a string. That is enough to
// encode the R6 intent: assert values flow as escapable TEXT children and that
// NO node uses dangerouslySetInnerHTML — React's own escaping is not ours to
// re-test.
interface Collected {
  texts: string[];
  hasDangerousHtml: boolean;
  imgs: Record<string, unknown>[];
  figcaptions: number;
}

function collect(node: ReactNode, acc: Collected): void {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, acc));
    return;
  }
  if (typeof node === "string" || typeof node === "number") {
    acc.texts.push(String(node));
    return;
  }
  if (isValidElement(node)) {
    const props = (node.props ?? {}) as Record<string, unknown>;
    if ("dangerouslySetInnerHTML" in props) acc.hasDangerousHtml = true;
    if (node.type === "img") acc.imgs.push(props);
    if (node.type === "figcaption") acc.figcaptions += 1;
    collect(props.children as ReactNode, acc);
  }
}

function inspect(node: ReactNode): Collected {
  const acc: Collected = { texts: [], hasDangerousHtml: false, imgs: [], figcaptions: 0 };
  collect(node, acc);
  return acc;
}

describe("getMediaProps — URL validation (security)", () => {
  it("returns empty props for null/undefined", () => {
    expect(getMediaProps(null, { mediaBaseUrl: CDN })).toEqual({ src: "", alt: "" });
    expect(getMediaProps(undefined, { mediaBaseUrl: CDN })).toEqual({ src: "", alt: "" });
  });

  it("accepts a string on the configured CDN origin, with alt ''", () => {
    expect(getMediaProps(CDN_URL, { mediaBaseUrl: CDN })).toEqual({ src: CDN_URL, alt: "" });
  });

  // The core threat: a crafted https URL on a FOREIGN origin must be rejected,
  // else every published render becomes a visitor-IP exfil beacon / SSRF.
  it("rejects a foreign https origin", () => {
    expect(getMediaProps("https://evil.example/beacon.png", { mediaBaseUrl: CDN }).src).toBe("");
  });

  it("rejects a non-https URL even on the CDN host", () => {
    expect(getMediaProps("http://staging.media.p1.pantheon.io/x.jpg", { mediaBaseUrl: CDN }).src).toBe("");
  });

  it("rejects dangerous and malformed schemes", () => {
    expect(getMediaProps("javascript:alert(1)", { mediaBaseUrl: CDN }).src).toBe("");
    expect(getMediaProps("data:image/png;base64,AAAA", { mediaBaseUrl: CDN }).src).toBe("");
    expect(getMediaProps("not a url", { mediaBaseUrl: CDN }).src).toBe("");
  });

  // Fail closed: a security helper must not degrade to insecure pass-through.
  it("fails closed (empty src) when no CDN origin is configured", () => {
    expect(getMediaProps(CDN_URL).src).toBe("");
    expect(getMediaProps(CDN_URL, {}).src).toBe("");
  });

  // Local dev carve-out: an http base is honored ONLY on a loopback host, so
  // rich values render against a local `wrangler dev` worker. Anything that
  // relaxes this beyond exact-origin loopback re-opens the exfil beacon.
  describe("http loopback carve-out (local dev)", () => {
    it("allows a same-origin http url when the base is http://localhost", () => {
      const url = "http://localhost:8788/image/site/assets/a/v-x.png";
      expect(getMediaProps(url, { mediaBaseUrl: "http://localhost:8788" }).src).toBe(url);
    });

    it("allows 127.0.0.1 and [::1] bases", () => {
      expect(
        getMediaProps("http://127.0.0.1:8788/x.png", { mediaBaseUrl: "http://127.0.0.1:8788" }).src,
      ).toBe("http://127.0.0.1:8788/x.png");
      expect(
        getMediaProps("http://[::1]:8788/x.png", { mediaBaseUrl: "http://[::1]:8788" }).src,
      ).toBe("http://[::1]:8788/x.png");
    });

    it("rejects an http base on a non-loopback host even when origins match", () => {
      expect(
        getMediaProps("http://media.internal/x.jpg", { mediaBaseUrl: "http://media.internal" }).src,
      ).toBe("");
    });

    it("rejects a *.localhost subdomain base (exact hostnames only)", () => {
      expect(
        getMediaProps("http://evil.localhost/x.jpg", { mediaBaseUrl: "http://evil.localhost" }).src,
      ).toBe("");
    });

    it("rejects an http localhost url when the configured base is the https CDN", () => {
      expect(getMediaProps("http://localhost:8788/x.png", { mediaBaseUrl: CDN }).src).toBe("");
    });

    it("still enforces exact origin on loopback (port mismatch rejected)", () => {
      expect(
        getMediaProps("http://localhost:9999/x.png", { mediaBaseUrl: "http://localhost:8788" }).src,
      ).toBe("");
    });

    // blob:http://… serializes to the inner URL's origin, so it passes the
    // origin check — the carve-out must still reject it (http only).
    it("rejects a blob: url even when its inner origin is the loopback base", () => {
      expect(
        getMediaProps("blob:http://localhost:8788/some-uuid", {
          mediaBaseUrl: "http://localhost:8788",
        }).src,
      ).toBe("");
    });
  });
});

describe("getMediaProps — string | MediaValue union", () => {
  it("reads alt from a MediaValue and validates its url", () => {
    const v: MediaValue = { assetId: "a", versionId: "v", url: CDN_URL, alt: "A cat" };
    expect(getMediaProps(v, { mediaBaseUrl: CDN })).toEqual({ src: CDN_URL, alt: "A cat" });
  });

  it("rejects a foreign url even on a fully-identified MediaValue", () => {
    const v: MediaValue = { assetId: "a", versionId: "v", url: "https://evil/x.jpg", alt: "x" };
    expect(getMediaProps(v, { mediaBaseUrl: CDN }).src).toBe("");
  });

  it("passes through numeric width/height and omits them otherwise", () => {
    const withDims: MediaValue = { assetId: "a", versionId: "v", url: CDN_URL, width: 800, height: 600 };
    expect(getMediaProps(withDims, { mediaBaseUrl: CDN })).toMatchObject({ width: 800, height: 600 });
    const noDims: MediaValue = { assetId: "a", versionId: "v", url: CDN_URL };
    const props = getMediaProps(noDims, { mediaBaseUrl: CDN });
    expect("width" in props).toBe(false);
    expect("height" in props).toBe(false);
  });

  it("merges transform params onto the validated src", () => {
    const props = getMediaProps(CDN_URL, { mediaBaseUrl: CDN, transform: { width: 1200, format: "webp" } });
    const url = new URL(props.src);
    expect(url.searchParams.get("width")).toBe("1200");
    expect(url.searchParams.get("format")).toBe("webp");
  });
});

describe("MediaImage", () => {
  it("renders an <img> with validated src and alt", () => {
    const el = MediaImage({ image: CDN_URL, mediaBaseUrl: CDN, alt: "override" });
    const { imgs } = inspect(el);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].src).toBe(CDN_URL);
    expect(imgs[0].alt).toBe("override");
  });

  it("renders nothing when the src is rejected", () => {
    const el = MediaImage({ image: "https://evil/x.jpg", mediaBaseUrl: CDN });
    expect(el).toBeNull();
  });
});

describe("MediaFigure — generic, escaped rendering (R14 + R6)", () => {
  const schema: MetadataFieldDef[] = [
    { name: "alt", label: "Alt text", type: "string" },
    { name: "byline", label: "Byline", type: "string" },
    { name: "caption", label: "Caption", type: "string" },
    { name: "location", label: "Location", type: "string" },
  ];

  it("renders present schema fields, skips absent ones, and keeps alt on the img", () => {
    const image: MediaValue = {
      assetId: "a", versionId: "v", url: CDN_URL,
      alt: "A cat", byline: "Jane", caption: "On a wall",
      // location intentionally absent
    };
    const { texts, imgs } = inspect(MediaFigure({ image, schema, mediaBaseUrl: CDN }));
    expect(texts).toContain("Jane");
    expect(texts).toContain("On a wall");
    expect(texts).not.toContain("A cat"); // alt lives on the <img>, not the caption
    expect(imgs[0].alt).toBe("A cat");
  });

  // R14: a field the plugin never knew about renders purely from the schema +
  // value — proof that adding a backend text field needs no plugin release.
  it("renders a brand-new schema field with no code change", () => {
    const withNewField = [...schema, { name: "credit", label: "Credit", type: "string" as const }];
    const image: MediaValue = { assetId: "a", versionId: "v", url: CDN_URL, credit: "Getty" };
    const { texts } = inspect(MediaFigure({ image, schema: withNewField, mediaBaseUrl: CDN }));
    expect(texts).toContain("Getty");
  });

  // R6: never dangerouslySetInnerHTML — the value flows as an escapable text child.
  it("passes metadata as text children and never uses dangerouslySetInnerHTML", () => {
    const evil = "<script>alert(1)</script>";
    const image: MediaValue = { assetId: "a", versionId: "v", url: CDN_URL, byline: evil };
    const { texts, hasDangerousHtml } = inspect(MediaFigure({ image, schema, mediaBaseUrl: CDN }));
    expect(hasDangerousHtml).toBe(false);
    expect(texts).toContain(evil); // raw string as a child → React escapes at render
  });

  it("falls back to the value's own string keys when no schema is passed", () => {
    const image: MediaValue = {
      assetId: "a", versionId: "v", url: CDN_URL,
      byline: "Jane", width: 800, // width is numeric → not caption text
    };
    const { texts } = inspect(MediaFigure({ image, mediaBaseUrl: CDN }));
    expect(texts).toContain("Jane");
    expect(texts).not.toContain("800");
  });

  it("renders nothing (and no caption) when the src is rejected", () => {
    const image: MediaValue = { assetId: "a", versionId: "v", url: "https://evil/x.jpg", byline: "Jane" };
    expect(MediaFigure({ image, schema, mediaBaseUrl: CDN })).toBeNull();
  });

  it("renders no figcaption when a basic string value carries no metadata", () => {
    const { imgs, figcaptions } = inspect(MediaFigure({ image: CDN_URL, schema, mediaBaseUrl: CDN }));
    expect(imgs).toHaveLength(1);
    expect(figcaptions).toBe(0);
  });
});
