import { beforeEach, describe, expect, it, vi } from "vitest";

import { initializeStores, type PageStore } from "../../data/dal";
import { resolvePageData } from "../../data/page-store";

const store = {
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  has: vi.fn().mockResolvedValue(false),
  keys: vi.fn().mockResolvedValue([]),
} satisfies PageStore;

describe("resolvePageData — static assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeStores({ pageStore: store });
  });

  it("returns null for asset paths without touching the store", async () => {
    for (const path of ["/logo.png", "/logo.png/", "/assets/app.min.js", "/fonts/inter.woff2"]) {
      await expect(resolvePageData(path)).resolves.toBeNull();
    }

    expect(store.get).not.toHaveBeenCalled();
    expect(store.keys).not.toHaveBeenCalled();
  });

  it("still resolves page paths that contain dots", async () => {
    await resolvePageData("/v1.2-release-notes");

    expect(store.get).toHaveBeenCalledWith("/v1.2-release-notes");
  });
});
