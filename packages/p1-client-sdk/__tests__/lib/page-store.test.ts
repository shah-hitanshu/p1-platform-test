import type { Data } from "@puckeditor/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deletePageAtPath,
  flattenStructureRoutes,
  type RouteRow,
} from "../../src/lib/page-store";
import { applySemanticOps, computeSemanticOps } from "../../src/lib/semantic-ops";

vi.mock("../../src/lib/page-editor-meta", () => ({
  removePageEditorMetaPath: vi.fn(),
}));

// In-memory page store mock
let storeData: Record<string, unknown> = {};

vi.mock("../../src/lib/dal", () => ({
  pageStore: {
    get: vi.fn((path: string) => storeData[path]),
    set: vi.fn((path: string, value: unknown) => { storeData[path] = value; }),
    delete: vi.fn((path: string) => { delete storeData[path]; }),
    has: vi.fn((path: string) => storeData[path] !== undefined),
    keys: vi.fn(() => Object.keys(storeData)),
  },
  editorMetaStore: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
  remoteDatasourceDefStore: {
    list: vi.fn(() => []),
    save: vi.fn(),
  },
}));

import { pageStore } from "../../src/lib/dal";

function seedStore(data: Record<string, unknown>) {
  storeData = structuredClone(data);
}

const sampleCanonical: Data = {
  root: { props: { title: "A" } },
  content: [
    {
      type: "HeadingBlock",
      props: { id: "h1", title: "Hero" },
    },
  ],
  zones: {},
};

describe("semantic ops (stable ids)", () => {
  it("round-trips a block prop change", () => {
    const edited: Data = {
      ...sampleCanonical,
      content: [
        {
          type: "HeadingBlock",
          props: { id: "h1", title: "Updated" },
        },
      ],
    };
    const ops = computeSemanticOps(sampleCanonical, edited);
    const merged = applySemanticOps(sampleCanonical, ops);
    expect((merged.content[0] as { props: { title: string } }).props.title).toBe(
      "Updated"
    );
  });

  it("round-trips moveBlock by stable id", () => {
    const canon: Data = {
      root: { props: {} },
      content: [
        { type: "HeadingBlock", props: { id: "a", title: "A" } },
        { type: "HeadingBlock", props: { id: "b", title: "B" } },
      ],
      zones: {},
    };
    const edited: Data = {
      root: { props: {} },
      content: [
        { type: "HeadingBlock", props: { id: "b", title: "B" } },
        { type: "HeadingBlock", props: { id: "a", title: "A" } },
      ],
      zones: {},
    };
    const ops = computeSemanticOps(canon, edited);
    const merged = applySemanticOps(canon, ops);
    expect((merged.content[0] as { props: { id: string } }).props.id).toBe("b");
    expect((merged.content[1] as { props: { id: string } }).props.id).toBe("a");
  });

  it("applies empty ops as identity", () => {
    const merged = applySemanticOps(sampleCanonical, []);
    expect(merged).toEqual(sampleCanonical);
  });
});

describe("flattenStructureRoutes", () => {
  it("nests overrides and full instances under the collection template row", () => {
    const routes: RouteRow[] = [
      { path: "/", kind: "static", patchOperations: 0 },
      { path: "/jedi/:id", kind: "template", patchOperations: 0 },
      { path: "/jedi/1", kind: "override", basePath: "/jedi/:id", patchOperations: 2 },
      { path: "/jedi/2", kind: "instance-full", patchOperations: 0 },
    ];
    const flat = flattenStructureRoutes(routes);
    const paths = flat.map((f) => ({ p: f.row.path, d: f.depth }));
    expect(paths).toEqual([
      { p: "/", d: 0 },
      { p: "/jedi/:id", d: 0 },
      { p: "/jedi/1", d: 1 },
      { p: "/jedi/2", d: 1 },
    ]);
  });
});

describe("migration (%3A path keys)", () => {
  afterEach(() => {
    storeData = {};
  });

  it("merges /jedi/%3Aid semantic override into /jedi/:id puck template", () => {
    seedStore({
      "/jedi/:id": {
        root: { props: { title: "Canon" } },
        content: [],
        zones: {},
      },
      "/jedi/%3Aid": {
        kind: "semantic",
        basePath: "/jedi/:id",
        ops: [{ op: "setRootProp", propPath: "title", value: "Merged title" }],
      },
    });

    // Trigger migration via any exported function
    deletePageAtPath("/nonexistent");

    expect(storeData["/jedi/%3Aid"]).toBeUndefined();
    expect((storeData["/jedi/:id"] as Data).root.props?.title).toBe("Merged title");
  });
});

describe("deletePageAtPath", () => {
  afterEach(() => {
    storeData = {};
  });

  it("deletes a single static page", () => {
    seedStore({ "/x": { root: { props: {} }, content: [], zones: {} } });
    const result = deletePageAtPath("/x");
    expect(result).toEqual({ ok: true, deletedPaths: ["/x"] });
    expect(storeData["/x"]).toBeUndefined();
  });

  it("cascades template deletion to overrides and instances", () => {
    seedStore({
      "/jedi/:id": { root: { props: { title: "T" } }, content: [], zones: {} },
      "/jedi/1": { kind: "semantic", basePath: "/jedi/:id", ops: [] },
      "/jedi/2": { root: { props: { title: "Full" } }, content: [], zones: {} },
    });
    const result = deletePageAtPath("/jedi/:id");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deletedPaths).toEqual(["/jedi/1", "/jedi/2", "/jedi/:id"]);
    }
    expect(Object.keys(storeData)).toEqual([]);
  });

  it("returns error when path is missing", () => {
    seedStore({});
    expect(deletePageAtPath("/nope")).toEqual({
      ok: false,
      error: "No page at this path.",
    });
  });

  it("allows deleting URL-encoded mistaken keys (e.g. %3A for :)", () => {
    const bad = "/jedi/%3Aid";
    seedStore({
      "/jedi/:id": { root: { props: { title: "Canon" } }, content: [], zones: {} },
      [bad]: { root: { props: { title: "Bad" } }, content: [], zones: {} },
    });
    expect(deletePageAtPath(bad)).toEqual({ ok: true, deletedPaths: [bad] });
    expect(storeData[bad]).toBeUndefined();
    expect(storeData["/jedi/:id"]).toBeDefined();
  });

  it("rejects paths with ..", () => {
    seedStore({});
    expect(deletePageAtPath("/foo/../bar")).toEqual({
      ok: false,
      error: "Invalid path.",
    });
  });
});
