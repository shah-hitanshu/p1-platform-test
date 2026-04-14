import type { Data } from "@puckeditor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodePagesBlocksTemplate } from "../../src/lib/cross-reference";
import { resolveCrossPageTemplates } from "../../src/lib/cross-reference-resolve";

vi.mock("../../src/lib/get-page", () => ({
  getPage: vi.fn(),
}));

import { getPage } from "../../src/lib/get-page";

function makePage(blocks: { id: string; type: string; props: Record<string, unknown> }[]): Data {
  return {
    root: { props: { title: "Page" } },
    content: blocks.map((b) => ({ type: b.type, props: { id: b.id, ...b.props } })),
    zones: {},
  } as unknown as Data;
}

describe("resolveCrossPageTemplates", () => {
  beforeEach(() => {
    vi.mocked(getPage).mockReset();
  });

  it("replaces a single cross-page ref with the target string value", () => {
    vi.mocked(getPage).mockImplementation((path) =>
      path === "/" ? makePage([{ id: "img-1", type: "ImageBlock", props: { src: "https://example.com/x.png" } }]) : null,
    );
    const token = encodePagesBlocksTemplate("/", "img-1", "src");
    expect(resolveCrossPageTemplates(`Src: ${token}`)).toBe("Src: https://example.com/x.png");
  });

  it("returns input unchanged when there are no template tokens", () => {
    expect(resolveCrossPageTemplates("plain text")).toBe("plain text");
    expect(resolveCrossPageTemplates("")).toBe("");
  });

  it("replaces multiple tokens in a single string", () => {
    vi.mocked(getPage).mockImplementation((path) =>
      path === "/about"
        ? makePage([
            { id: "h1", type: "HeadingBlock", props: { text: "About Us" } },
            { id: "p1", type: "ParagraphBlock", props: { text: "Welcome" } },
          ])
        : null,
    );
    const t1 = encodePagesBlocksTemplate("/about", "h1", "text");
    const t2 = encodePagesBlocksTemplate("/about", "p1", "text");
    expect(resolveCrossPageTemplates(`${t1} - ${t2}`)).toBe("About Us - Welcome");
  });

  it("returns empty string for a token referencing a page that does not exist", () => {
    vi.mocked(getPage).mockReturnValue(null);
    const token = encodePagesBlocksTemplate("/missing", "b1", "text");
    expect(resolveCrossPageTemplates(token)).toBe("");
  });

  it("returns empty string for a token referencing a block that does not exist", () => {
    vi.mocked(getPage).mockImplementation((path) =>
      path === "/" ? makePage([{ id: "real", type: "HeadingBlock", props: { text: "Hi" } }]) : null,
    );
    const token = encodePagesBlocksTemplate("/", "nonexistent", "text");
    expect(resolveCrossPageTemplates(token)).toBe("");
  });

  it("converts numeric prop values to string", () => {
    vi.mocked(getPage).mockImplementation((path) =>
      path === "/" ? makePage([{ id: "spacer", type: "SpacerBlock", props: { height: 42 } }]) : null,
    );
    const token = encodePagesBlocksTemplate("/", "spacer", "height");
    expect(resolveCrossPageTemplates(token)).toBe("42");
  });

  it("converts boolean prop values to string", () => {
    vi.mocked(getPage).mockImplementation((path) =>
      path === "/" ? makePage([{ id: "b1", type: "Block", props: { visible: true } }]) : null,
    );
    const token = encodePagesBlocksTemplate("/", "b1", "visible");
    expect(resolveCrossPageTemplates(token)).toBe("true");
  });

  it("returns empty string for null/undefined prop values", () => {
    vi.mocked(getPage).mockImplementation((path) =>
      path === "/" ? makePage([{ id: "b1", type: "Block", props: { empty: null } }]) : null,
    );
    const token = encodePagesBlocksTemplate("/", "b1", "empty");
    expect(resolveCrossPageTemplates(token)).toBe("");
  });

  it("normalises trailing slashes in paths", () => {
    vi.mocked(getPage).mockImplementation((path) =>
      path === "/about" ? makePage([{ id: "h1", type: "HeadingBlock", props: { text: "About" } }]) : null,
    );
    const token = encodePagesBlocksTemplate("/about/", "h1", "text");
    expect(resolveCrossPageTemplates(token)).toBe("About");
  });

  it("recursively resolves chained cross-page refs", () => {
    const pageA = makePage([{ id: "b1", type: "Block", props: { text: encodePagesBlocksTemplate("/b", "b2", "text") } }]);
    const pageB = makePage([{ id: "b2", type: "Block", props: { text: "final" } }]);
    vi.mocked(getPage).mockImplementation((path) => {
      if (path === "/a") return pageA;
      if (path === "/b") return pageB;
      return null;
    });
    const token = encodePagesBlocksTemplate("/a", "b1", "text");
    expect(resolveCrossPageTemplates(token)).toBe("final");
  });

  it("stops when replacement equals input (self-referencing token)", () => {
    const selfRef = encodePagesBlocksTemplate("/loop", "b1", "text");
    const page = makePage([{ id: "b1", type: "Block", props: { text: selfRef } }]);
    vi.mocked(getPage).mockImplementation((path) => (path === "/loop" ? page : null));
    // Self-ref resolves to itself, so the function short-circuits and returns the token
    expect(resolveCrossPageTemplates(selfRef)).toBe(selfRef);
  });

  it("preserves surrounding text when token resolves to empty", () => {
    vi.mocked(getPage).mockReturnValue(null);
    const token = encodePagesBlocksTemplate("/nope", "b1", "x");
    expect(resolveCrossPageTemplates(`before ${token} after`)).toBe("before  after");
  });
});
