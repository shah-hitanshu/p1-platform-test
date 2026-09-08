import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const {
  loadPublishedPage,
  loadRouteTemplateKeys,
  notFound,
  resolveDataTemplates,
  loadRemoteDatasourceContext,
  createCssQueryFetchers,
} = vi.hoisted(() => ({
  loadPublishedPage: vi.fn(),
  loadRouteTemplateKeys: vi.fn().mockResolvedValue(["blog"]),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  resolveDataTemplates: vi.fn(async (data: unknown) => ({
    ...(data as object),
    resolved: true,
  })),
  loadRemoteDatasourceContext: vi.fn().mockResolvedValue({ ctx: true }),
  createCssQueryFetchers: vi.fn().mockReturnValue([{ id: "css" }]),
}));

vi.mock("../published-page", () => ({ loadPublishedPage, loadRouteTemplateKeys }));
vi.mock("../css-query-fetchers", () => ({ createCssQueryFetchers }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@pantheon-systems/puck-css/server", () => ({
  resolveStringTemplates: vi.fn(),
  loadRemoteDatasourceContext,
  resolveDataTemplates,
  extractReferencedDatasourceIds: vi.fn().mockReturnValue(["ds-1"]),
  pagePathFromCatchAllSegments: (segments: string[]) => `/${segments.join("/")}`,
}));

import {
  createPublishedPage,
  type PublishedPageClientProps,
} from "../create-published-page";

const Client = (_props: PublishedPageClientProps) => null;
const Unavailable = () => null;
const Fallback = () => null;

const build = (overrides = {}) =>
  createPublishedPage({
    Client,
    Unavailable,
    Fallback,
    fetchers: [{ id: "app" }] as never,
    resolveMetadata: async ({ path }) => ({ title: `Page ${path}` }),
    ...overrides,
  });

const pageData = { root: { props: { title: "Contact" } }, content: [] };
const params = (...segments: string[]) =>
  ({ params: Promise.resolve({ puckPath: segments }) });

describe("createPublishedPage", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("catch-all route", () => {
    // The route is statically renderable, so a 200 here would write every junk
    // URL a crawler probes into the response cache as a successful page.
    it("404s a path with no published page", async () => {
      loadPublishedPage.mockResolvedValue({ status: "missing" });
      await expect(build().Page(params("nope"))).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
    });

    // 404ing here would deindex a live page over a transient backend blip.
    it("renders the outage component instead of 404ing", async () => {
      loadPublishedPage.mockResolvedValue({ status: "unavailable" });
      const element = (await build().Page(params("real"))) as ReactElement;
      expect(element.type).toBe(Unavailable);
      expect(notFound).not.toHaveBeenCalled();
    });

    it("renders resolved data through the app's client", async () => {
      loadPublishedPage.mockResolvedValue({ status: "ok", data: pageData });
      const element = (await build().Page(params("contact"))) as ReactElement;

      expect(element.type).toBe(Client);
      expect(element.props.data).toEqual({ ...pageData, resolved: true });
      expect(element.props.pageMetadata).toEqual({
        route: "/contact",
        documentName: "Contact",
        pageType: "page",
      });
    });

    // Route templates and datasource context are what make a collection page
    // render as anything other than its raw template.
    it("resolves datasources against the app's fetchers and the CCR ones", async () => {
      loadPublishedPage.mockResolvedValue({ status: "ok", data: pageData });
      await build().Page(params("contact"));

      expect(loadRemoteDatasourceContext).toHaveBeenCalledWith(
        expect.objectContaining({
          pagePath: "/contact",
          routeTemplateKeys: ["blog"],
          referencedDatasourceIds: ["ds-1"],
          builtinFetchers: [{ id: "app" }, { id: "css" }],
        }),
      );
    });

    it("forwards extra internal path prefixes to the reader", async () => {
      loadPublishedPage.mockResolvedValue({ status: "missing" });
      const published = build({ internalPathPrefixes: ["/_private"] });
      await expect(published.Page(params("_private", "x"))).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
      expect(loadPublishedPage).toHaveBeenCalledWith("/_private/x", {
        internalPathPrefixes: ["/_private"],
      });
    });

    // Declaring it is what marks the segment statically renderable; without it
    // no response from this route is ever cacheable.
    it("declares an empty static-params list", () => {
      expect(build().generateStaticParams()).toEqual([]);
    });
  });

  describe("catch-all metadata", () => {
    it.each([
      ["missing", "Not Found"],
      ["unavailable", "Temporarily unavailable"],
    ])("titles a %s page %o", async (status, title) => {
      loadPublishedPage.mockResolvedValue({ status });
      expect(await build().generateMetadata(params("x"))).toEqual({ title });
    });

    it("delegates a resolved page to the app's metadata resolver", async () => {
      loadPublishedPage.mockResolvedValue({ status: "ok", data: pageData });
      expect(await build().generateMetadata(params("contact"))).toEqual({
        title: "Page /contact",
      });
    });

    // Metadata behaviour is the SDK's, so a scaffold picks up changes to it on a
    // package upgrade rather than carrying its own copy of the mapping.
    it("maps the stored root props itself when no resolver is given", async () => {
      loadPublishedPage.mockResolvedValue({ status: "ok", data: pageData });
      const published = createPublishedPage({ Client, Unavailable, Fallback });

      expect(await published.generateMetadata(params("contact"))).toMatchObject({
        title: "Contact",
        openGraph: { title: "Contact" },
      });
    });

    it("uses caller-supplied titles when given", async () => {
      loadPublishedPage.mockResolvedValue({ status: "missing" });
      const published = build({ titles: { notFound: "Nothing here" } });
      expect(await published.generateMetadata(params("x"))).toEqual({
        title: "Nothing here",
      });
    });
  });

  describe("home route", () => {
    // "/" is a single fixed URL, not an unbounded crawler surface, and a
    // welcome state is the right answer for a site with no content yet.
    it.each(["missing", "unavailable"])(
      "renders the fallback rather than 404ing when the home page is %s",
      async (status) => {
        loadPublishedPage.mockResolvedValue({ status });
        const element = (await build().HomePage()) as ReactElement;
        expect(element.type).toBe(Fallback);
        expect(notFound).not.toHaveBeenCalled();
      },
    );

    it("renders a published home page through the same pipeline", async () => {
      loadPublishedPage.mockResolvedValue({ status: "ok", data: pageData });
      const element = (await build().HomePage()) as ReactElement;

      expect(loadPublishedPage).toHaveBeenCalledWith("/", undefined);
      expect(element.type).toBe(Client);
      expect(element.props.data).toEqual({ ...pageData, resolved: true });
      expect(element.props.pageMetadata.route).toBe("/");
    });

    it("titles the fallback with the caller's home title", async () => {
      loadPublishedPage.mockResolvedValue({ status: "missing" });
      const published = build({ titles: { home: "P1 Starter Kit" } });
      expect(await published.generateHomeMetadata()).toEqual({
        title: "P1 Starter Kit",
      });
    });

    it("delegates a published home page to the app's metadata resolver", async () => {
      loadPublishedPage.mockResolvedValue({ status: "ok", data: pageData });
      expect(await build().generateHomeMetadata()).toEqual({ title: "Page /" });
    });
  });
});
