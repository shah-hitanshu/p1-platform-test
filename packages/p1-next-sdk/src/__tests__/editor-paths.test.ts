/**
 * The editor now lives in a persistent layout and derives the page path from
 * the browser URL client-side. These helpers must match the server-side
 * segment parsing in pages-handler exactly, or the layout-rendered editor and
 * generateMetadata would disagree about which document a URL addresses.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseEditorSegments,
  editorPagePathFromUrlPath,
} from "../editor-paths";

describe("parseEditorSegments", () => {
  it("maps no segments to the root page", () => {
    expect(parseEditorSegments([])).toBe("/");
  });

  it("maps the api command to the root page", () => {
    expect(parseEditorSegments(["api", "publish"])).toBe("/");
  });

  it("maps edit with no rest to the root page", () => {
    expect(parseEditorSegments(["edit"])).toBe("/");
  });

  it("maps edit plus segments to that page path", () => {
    expect(parseEditorSegments(["edit", "foo", "bar"])).toBe("/foo/bar");
  });

  it("maps plain segments to that page path", () => {
    expect(parseEditorSegments(["foo"])).toBe("/foo");
    expect(parseEditorSegments(["foo", "bar"])).toBe("/foo/bar");
  });

  it("decodes URL-encoded segments", () => {
    expect(parseEditorSegments(["jedi", "%3Aid"])).toBe("/jedi/:id");
  });
});

describe("editorPagePathFromUrlPath", () => {
  it("maps the bare base path to the root page", () => {
    expect(editorPagePathFromUrlPath("/p1")).toBe("/");
    expect(editorPagePathFromUrlPath("/p1/")).toBe("/");
  });

  it("maps edit URLs like the server does", () => {
    expect(editorPagePathFromUrlPath("/p1/edit")).toBe("/");
    expect(editorPagePathFromUrlPath("/p1/edit/foo/bar")).toBe("/foo/bar");
  });

  it("maps page URLs to their page path", () => {
    expect(editorPagePathFromUrlPath("/p1/foo")).toBe("/foo");
    expect(editorPagePathFromUrlPath("/p1/foo/bar")).toBe("/foo/bar");
  });

  it("supports a custom base path", () => {
    expect(editorPagePathFromUrlPath("/studio/foo", "/studio")).toBe("/foo");
    expect(editorPagePathFromUrlPath("/studio", "/studio")).toBe("/");
  });

  it("falls back to the root page for URLs outside the base path, loudly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(editorPagePathFromUrlPath("/somewhere/else")).toBe("/");
    expect(warn).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
