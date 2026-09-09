import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  revalidatePath,
  persistPublishedPage,
  listOverridePathsForBase,
  isRouteTemplatePath,
} = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  persistPublishedPage: vi.fn().mockResolvedValue(undefined),
  listOverridePathsForBase: vi.fn().mockResolvedValue([]),
  isRouteTemplatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

vi.mock("@pantheon-systems/puck-css/server", () => ({
  isRouteTemplatePath,
  // Faithful to the real normalizer for what these tests turn on: it returns
  // null for a reserved prefix or a path the page-path regex refuses.
  normalizePath: (p: string) =>
    p.startsWith("/p1") || /[^a-zA-Z0-9/_\-:.]/.test(p.slice(1)) ? null : p,
  listOverridePathsForBase,
  persistPublishedPage,
}));

import { postRevalidate } from "../routes/revalidate";

const post = (body: unknown, opts?: { publicPageSegment?: string }) =>
  postRevalidate(
    new Request("http://localhost/p1/api/revalidate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    opts,
  );

describe("revalidate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOverridePathsForBase.mockResolvedValue([]);
  });

  it("invalidates the published path for an ordinary page", async () => {
    isRouteTemplatePath.mockReturnValue(false);
    const res = await post({ path: "/about" });
    expect(res.status).toBe(200);
    expect(revalidatePath.mock.calls).toEqual([["/about"]]);
  });

  it("invalidates the public catch-all segment for a route template", async () => {
    isRouteTemplatePath.mockReturnValue(true);
    listOverridePathsForBase.mockResolvedValue(["/jedi/7"]);
    await post({ path: "/jedi/:id" });
    expect(revalidatePath.mock.calls).toEqual([
      ["/jedi/:id"],
      ["/jedi/7"],
      ["/[...puckPath]", "page"],
    ]);
  });

  it("honors a custom public page segment", async () => {
    isRouteTemplatePath.mockReturnValue(true);
    await post({ path: "/jedi/:id" }, { publicPageSegment: "/[...slug]" });
    expect(revalidatePath).toHaveBeenCalledWith("/[...slug]", "page");
  });

  it("passes the root path through without normalization", async () => {
    isRouteTemplatePath.mockReturnValue(false);
    await post({ path: "/" });
    expect(revalidatePath.mock.calls).toEqual([["/"]]);
  });

  // Callers reach this route with whatever path the editor had open, so a
  // rejected path must not become a revalidatePath argument.
  it("rejects a malformed path", async () => {
    const res = await post({ path: "/bad path" });
    expect(res.status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a path in the app's own reserved namespace", async () => {
    const res = await post({ path: "/p1/api/publish" });
    expect(res.status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a body with no path", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a non-string path", async () => {
    const res = await post({ path: 42 });
    expect(res.status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // Nothing is persisted here: the content is already in the backend, and a
  // second write path for the same page is how the two drift.
  it("does not write page content", async () => {
    isRouteTemplatePath.mockReturnValue(false);
    await post({ path: "/about" });
    expect(persistPublishedPage).not.toHaveBeenCalled();
  });
});
