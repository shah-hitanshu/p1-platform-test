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
  normalizePath: (p: string) => p,
  listOverridePathsForBase,
  persistPublishedPage,
}));

import { postPublish } from "../routes/publish";

const publish = (path: string) =>
  postPublish(
    new Request("http://localhost/p1/api/publish", {
      method: "POST",
      body: JSON.stringify({ path, data: { root: { props: {} }, content: [] } }),
    }),
  );

describe("publish revalidation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revalidates only the published path for an ordinary page", async () => {
    isRouteTemplatePath.mockReturnValue(false);
    await publish("/about");
    expect(revalidatePath.mock.calls).toEqual([["/about"]]);
  });

  // Instance URLs like /jedi/5 resolve against /jedi/:id with no store entry, so
  // they cannot be enumerated and listOverridePathsForBase never yields them.
  // Without invalidating the catch-all segment they serve pre-edit content for
  // the full revalidate window.
  it("invalidates the public catch-all segment when a route template is published", async () => {
    isRouteTemplatePath.mockReturnValue(true);
    listOverridePathsForBase.mockResolvedValue(["/jedi/7"]);
    await publish("/jedi/:id");
    expect(revalidatePath.mock.calls).toEqual([
      ["/jedi/:id"],
      ["/jedi/7"],
      ["/[...puckPath]", "page"],
    ]);
  });

  it("honors a custom public page segment", async () => {
    isRouteTemplatePath.mockReturnValue(true);
    await postPublish(
      new Request("http://localhost/p1/api/publish", {
        method: "POST",
        body: JSON.stringify({
          path: "/jedi/:id",
          data: { root: { props: {} }, content: [] },
        }),
      }),
      { publicPageSegment: "/[...slug]" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/[...slug]", "page");
  });
});
