import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Cards } from "../data/data-list-block/builtin-components/cards.js";
import { Rows } from "../data/data-list-block/builtin-components/rows.js";
import { Listing } from "../data/data-list-block/builtin-components/listing.js";
import type { ResolvedItem } from "../data/data-list-block/types.js";

const baseProps = {
  showTitle: true,
  showSubtitle: true,
  showTeaser: true,
  showImage: true,
  showIcon: true,
};

function makeItems(count = 2): ResolvedItem[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Title ${i}`,
    subtitle: `Sub ${i}`,
    teaser: `Teaser ${i}`,
    image: `/img${i}.png`,
    icon: `icon-${i}`,
    _raw: { id: i },
  }));
}

describe("Cards", () => {
  it("renders all items", () => {
    const items = makeItems(3);
    render(
      <Cards
        items={items}
        {...baseProps}
        columns={3}
        imagePosition="top"
      />,
    );
    expect(screen.getAllByText(/^Title \d$/)).toHaveLength(3);
  });

  it("renders titles when showTitle is true", () => {
    render(
      <Cards
        items={makeItems(1)}
        {...baseProps}
        columns={2}
        imagePosition="top"
      />,
    );
    expect(screen.getByText("Title 0")).toBeTruthy();
  });

  it("hides titles when showTitle is false", () => {
    render(
      <Cards
        items={makeItems(1)}
        {...baseProps}
        showTitle={false}
        columns={2}
        imagePosition="top"
      />,
    );
    expect(screen.queryByText("Title 0")).toBeNull();
  });

  it("renders images when imagePosition is not none", () => {
    const { container } = render(
      <Cards
        items={makeItems(1)}
        {...baseProps}
        columns={1}
        imagePosition="left"
      />,
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(1);
  });

  it("hides images when imagePosition is none", () => {
    const { container } = render(
      <Cards
        items={makeItems(1)}
        {...baseProps}
        columns={1}
        imagePosition="none"
      />,
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(0);
  });

  it("renders backdrop layout", () => {
    const { container } = render(
      <Cards
        items={makeItems(1)}
        {...baseProps}
        columns={1}
        imagePosition="backdrop"
      />,
    );
    const backdrop = container.querySelector("[style]");
    expect(backdrop).toBeTruthy();
  });
});

describe("Rows", () => {
  it("renders all items", () => {
    render(
      <Rows
        items={makeItems(2)}
        {...baseProps}
        rowDensity="comfortable"
        imagePosition="left"
      />,
    );
    expect(screen.getAllByText(/^Title \d$/)).toHaveLength(2);
  });

  it("shows images when imagePosition is not none", () => {
    const { container } = render(
      <Rows
        items={makeItems(1)}
        {...baseProps}
        rowDensity="comfortable"
        imagePosition="left"
      />,
    );
    expect(container.querySelectorAll("img").length).toBe(1);
  });

  it("hides images when imagePosition is none", () => {
    const { container } = render(
      <Rows
        items={makeItems(1)}
        {...baseProps}
        rowDensity="comfortable"
        imagePosition="none"
      />,
    );
    expect(container.querySelectorAll("img").length).toBe(0);
  });

  it("applies compact styling", () => {
    const { container } = render(
      <Rows
        items={makeItems(1)}
        {...baseProps}
        rowDensity="compact"
        imagePosition="left"
      />,
    );
    const row = container.querySelector("[class*='p-2']");
    expect(row).toBeTruthy();
  });

  it("applies comfortable styling", () => {
    const { container } = render(
      <Rows
        items={makeItems(1)}
        {...baseProps}
        rowDensity="comfortable"
        imagePosition="left"
      />,
    );
    const row = container.querySelector("[class*='p-3']");
    expect(row).toBeTruthy();
  });
});

describe("Listing", () => {
  it("renders all items", () => {
    render(
      <Listing
        items={makeItems(2)}
        {...baseProps}
        listingWidth="wide"
        imagePosition="left"
      />,
    );
    expect(screen.getAllByText(/^Title \d$/)).toHaveLength(2);
  });

  it("shows images when imagePosition is left", () => {
    const { container } = render(
      <Listing
        items={makeItems(1)}
        {...baseProps}
        listingWidth="wide"
        imagePosition="left"
      />,
    );
    expect(container.querySelectorAll("img").length).toBe(1);
  });

  it("hides images when imagePosition is none", () => {
    const { container } = render(
      <Listing
        items={makeItems(1)}
        {...baseProps}
        listingWidth="wide"
        imagePosition="none"
      />,
    );
    expect(container.querySelectorAll("img").length).toBe(0);
  });

  it("applies narrow width class", () => {
    const { container } = render(
      <Listing
        items={makeItems(1)}
        {...baseProps}
        listingWidth="narrow"
        imagePosition="left"
      />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("max-w-2xl");
  });

  it("renders right-positioned images with flex-row-reverse", () => {
    const { container } = render(
      <Listing
        items={makeItems(1)}
        {...baseProps}
        listingWidth="wide"
        imagePosition="right"
      />,
    );
    const card = container.querySelector("[class*='flex-row-reverse']");
    expect(card).toBeTruthy();
  });
});
