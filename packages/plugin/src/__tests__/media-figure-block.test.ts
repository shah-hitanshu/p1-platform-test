import { describe, it, expect } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createMediaFigureBlock } from "../media-figure-block";
import type { MediaValue } from "../types";

const CDN = "https://staging.media.p1.pantheon.io";
const CDN_URL = `${CDN}/site/assets/a/v-photo.jpg`;

// Same element-tree inspection approach as render.test.ts (react-dom is
// intentionally absent from this package): function components are invoked
// so the tree bottoms out at host elements.
function collectImgs(node: ReactNode, acc: Array<Record<string, unknown>>): void {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectImgs(n, acc));
    return;
  }
  if (isValidElement(node)) {
    const props = (node.props ?? {}) as Record<string, unknown>;
    if (typeof node.type === "function") {
      collectImgs((node.type as (p: unknown) => ReactNode)(props), acc);
      return;
    }
    if (node.type === "img") acc.push(props);
    collectImgs(props.children as ReactNode, acc);
  }
}

function renderBlock(block: ReturnType<typeof createMediaFigureBlock>, photo: unknown): ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (block.render as (p: any) => ReactElement)({ photo });
}

describe("createMediaFigureBlock", () => {
  const block = createMediaFigureBlock({ mediaBaseUrl: CDN });

  it("declares a p1-media field and a null default", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((block.fields as any).photo.type).toBe("p1-media");
    expect(block.defaultProps).toEqual({ photo: null });
    expect(block.label).toBe("Media Figure");
  });

  it("renders the placeholder when no photo is set", () => {
    const el = renderBlock(block, null);
    const imgs: Array<Record<string, unknown>> = [];
    collectImgs(el, imgs);
    expect(imgs).toHaveLength(0);
  });

  it("renders the placeholder (not a broken img) when the URL fails origin validation", () => {
    const photo: MediaValue = { assetId: "a", versionId: "v", url: "https://evil.example/x.jpg" };
    const imgs: Array<Record<string, unknown>> = [];
    collectImgs(renderBlock(block, photo), imgs);
    expect(imgs).toHaveLength(0);
  });

  it("renders a MediaFigure img with the default width+height transform applied", () => {
    const photo: MediaValue = { assetId: "a", versionId: "v", url: CDN_URL, alt: "A cat" };
    const imgs: Array<Record<string, unknown>> = [];
    collectImgs(renderBlock(block, photo), imgs);
    expect(imgs).toHaveLength(1);
    const src = String(imgs[0].src);
    expect(src.startsWith(CDN_URL)).toBe(true);
    // both dimensions present — without height the crop intent is a no-op
    expect(src).toContain("width=1200");
    expect(src).toContain("height=630");
    expect(imgs[0].alt).toBe("A cat");
  });

  it("honors option overrides (label, transform, placeholder)", () => {
    const custom = createMediaFigureBlock({
      mediaBaseUrl: CDN,
      label: "Hero",
      fieldLabel: "Hero image",
      transform: { width: 800, height: 800 },
      placeholder: createElement("span", null, "empty"),
    });
    expect(custom.label).toBe("Hero");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((custom.fields as any).photo.label).toBe("Hero image");
    const photo: MediaValue = { assetId: "a", versionId: "v", url: CDN_URL };
    const imgs: Array<Record<string, unknown>> = [];
    collectImgs(renderBlock(custom, photo), imgs);
    expect(String(imgs[0].src)).toContain("width=800");
    expect(String(imgs[0].src)).toContain("height=800");
  });
});
