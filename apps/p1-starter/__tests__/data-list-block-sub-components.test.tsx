import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedItem, LayoutProps } from "@pantheon-systems/puck-css/fields";

const ITEMS: ResolvedItem[] = [
  {
    title: "Alpha",
    subtitle: "First item",
    teaser: "A brief preview of the first item",
    image: "https://example.com/alpha.jpg",
    icon: "star",
    _raw: { name: "Alpha" },
  },
  {
    title: "Beta",
    subtitle: "Second item",
    teaser: "A brief preview of the second item",
    image: "https://example.com/beta.jpg",
    icon: "circle",
    _raw: { name: "Beta" },
  },
  {
    title: "Gamma",
    subtitle: "Third item",
    teaser: "",
    image: "",
    icon: "",
    _raw: { name: "Gamma" },
  },
];

const BASE_PROPS: LayoutProps = {
  items: ITEMS,
  showTitle: true,
  showSubtitle: true,
  showTeaser: true,
  showImage: true,
  showIcon: true,
};

describe("Cards sub-component", () => {
  it("renders all item titles", async () => {
    const { Cards } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Cards {...BASE_PROPS} columns={3} imagePosition="top" />,
    );
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("Gamma");
  });

  it("hides titles when showTitle is false", async () => {
    const { Cards } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Cards
        {...BASE_PROPS}
        showTitle={false}
        showImage={false}
        columns={3}
        imagePosition="top"
      />,
    );
    expect(html).not.toContain("Alpha");
    expect(html).not.toContain("Beta");
  });

  it("hides images when showImage is false", async () => {
    const { Cards } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Cards
        {...BASE_PROPS}
        showImage={false}
        columns={3}
        imagePosition="top"
      />,
    );
    expect(html).not.toContain("<img");
  });

  it("renders images when showImage is true and image exists", async () => {
    const { Cards } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Cards {...BASE_PROPS} columns={3} imagePosition="top" />,
    );
    expect(html).toContain("alpha.jpg");
    expect(html).toContain("beta.jpg");
  });

  it("hides subtitles when showSubtitle is false", async () => {
    const { Cards } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Cards
        {...BASE_PROPS}
        showSubtitle={false}
        columns={3}
        imagePosition="top"
      />,
    );
    expect(html).not.toContain("First item");
  });

  it("hides teasers when showTeaser is false", async () => {
    const { Cards } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Cards
        {...BASE_PROPS}
        showTeaser={false}
        columns={3}
        imagePosition="top"
      />,
    );
    expect(html).not.toContain("A brief preview of the first item");
  });
});

describe("Rows sub-component", () => {
  it("renders all item titles", async () => {
    const { Rows } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Rows {...BASE_PROPS} rowDensity="comfortable" imagePosition="left" />,
    );
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("Gamma");
  });

  it("hides titles when showTitle is false", async () => {
    const { Rows } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Rows
        {...BASE_PROPS}
        showTitle={false}
        rowDensity="comfortable"
        imagePosition="none"
      />,
    );
    expect(html).not.toContain("Alpha");
  });

  it("hides images when imagePosition is none", async () => {
    const { Rows } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Rows
        {...BASE_PROPS}
        rowDensity="comfortable"
        imagePosition="none"
      />,
    );
    expect(html).not.toContain("<img");
  });
});

describe("Listing sub-component", () => {
  it("renders all item titles", async () => {
    const { Listing } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Listing
        {...BASE_PROPS}
        imagePosition="left"
        listingWidth="wide"
      />,
    );
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("Gamma");
  });

  it("hides titles when showTitle is false", async () => {
    const { Listing } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Listing
        {...BASE_PROPS}
        showTitle={false}
        showImage={false}
        imagePosition="left"
        listingWidth="wide"
      />,
    );
    expect(html).not.toContain("Alpha");
  });

  it("hides images when showImage is false", async () => {
    const { Listing } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Listing
        {...BASE_PROPS}
        showImage={false}
        imagePosition="left"
        listingWidth="wide"
      />,
    );
    expect(html).not.toContain("<img");
  });

  it("renders teasers when showTeaser is true", async () => {
    const { Listing } = await import("@pantheon-systems/puck-css/fields");
    const html = renderToStaticMarkup(
      <Listing
        {...BASE_PROPS}
        imagePosition="left"
        listingWidth="wide"
      />,
    );
    expect(html).toContain("A brief preview of the first item");
  });
});
