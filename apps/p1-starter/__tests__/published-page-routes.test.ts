/**
 * The render pipeline itself is tested in the SDK (create-published-page.test.tsx).
 * What matters here is the wiring: that both routes are shims over the factory,
 * and that the segment config Next.js statically analyzes survives in the files.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const starterDir = resolve(__dirname, "..");

const factory = vi.hoisted(() => ({
  Page: () => null,
  HomePage: () => null,
  generateMetadata: vi.fn(),
  generateHomeMetadata: vi.fn(),
  generateStaticParams: vi.fn(),
}));

vi.mock("@pantheon-systems/p1-next-sdk/server", () => ({
  createPublishedPage: vi.fn(() => factory),
  loadRouteTemplateKeys: vi.fn(),
}));

// The routes reach these through app/published-pages.tsx. Mocked so this stays
// a wiring test: importing the real modules drags in the whole datasource graph,
// which is not installed when the built template's copy of this test runs
// inside the create-p1-starter-kit package.
vi.mock("../lib/remote-datasource-fetchers", () => ({
  REMOTE_DATASOURCE_FETCHERS: [],
}));
vi.mock("../lib/page-seo", () => ({ resolvePageMetadata: vi.fn() }));

vi.mock("../app/[...puckPath]/client", () => ({ Client: () => null }));
vi.mock("../components/puck/welcome-block-render", () => ({
  WelcomeBlockRender: () => null,
}));

const routes = {
  catchAll: "app/[...puckPath]/page.tsx",
  home: "app/page.tsx",
} as const;

describe("published page routes are shims over the SDK factory", () => {
  it("wires the catch-all route to the factory", async () => {
    const route = await import("../app/[...puckPath]/page");
    expect(route.default).toBe(factory.Page);
    expect(route.generateMetadata).toBe(factory.generateMetadata);
    expect(route.generateStaticParams).toBe(factory.generateStaticParams);
  });

  it("wires the home route to the factory", async () => {
    const route = await import("../app/page");
    expect(route.default).toBe(factory.HomePage);
    expect(route.generateMetadata).toBe(factory.generateHomeMetadata);
  });

  // Next.js statically analyzes segment-config exports, so this value cannot be
  // re-exported through the factory — a computed or forwarded `revalidate` goes
  // undetected and the route silently loses its revalidation window.
  it.each(Object.values(routes))(
    "keeps revalidate a literal export in %s",
    (file) => {
      const source = readFileSync(resolve(starterDir, file), "utf-8");
      expect(source).toMatch(/^export const revalidate = \d+;$/m);
    },
  );

  // The pipeline is the SDK's now; a copy growing back here is the regression
  // this guards against.
  it.each(Object.values(routes))("leaves no pipeline logic in %s", (file) => {
    const source = readFileSync(resolve(starterDir, file), "utf-8");
    for (const symbol of [
      "loadPublishedPage",
      "loadRemoteDatasourceContext",
      "resolveDataTemplates",
      "isInternalPath",
      "notFound",
    ]) {
      expect(source).not.toContain(symbol);
    }
  });
});
