import { describe, expect, it } from "vitest";

const fieldsOf = (block: { fields: Record<string, unknown> }) =>
  block.fields as Record<string, { type?: string }>;

describe("dataListBlock", () => {
  it("has label 'List'", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(dataListBlock.label).toBe("List");
  });

  it("has a custom datasourceId field", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).datasourceId.type).toBe("custom");
  });

  it("has a custom field for viewMode", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).viewMode.type).toBe("custom");
  });

  it("has custom schema-select fields for item field mappings", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).titleField.type).toBe("custom");
    expect(fieldsOf(dataListBlock).subtitleField.type).toBe("custom");
    expect(fieldsOf(dataListBlock).teaserField.type).toBe("custom");
    expect(fieldsOf(dataListBlock).imageField.type).toBe("custom");
    expect(fieldsOf(dataListBlock).iconField.type).toBe("custom");
  });

  it("does not expose separate radio fields for visibility toggles (inline in schema-select)", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    const fields = dataListBlock.fields as Record<string, unknown>;
    expect(fields.showTitle).toBeUndefined();
    expect(fields.showSubtitle).toBeUndefined();
    expect(fields.showTeaser).toBeUndefined();
    expect(fields.showImage).toBeUndefined();
    expect(fields.showIcon).toBeUndefined();
  });

  it("has a unified imagePosition custom field", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).imagePosition.type).toBe("custom");
  });

  it("does not expose per-view image position fields", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    const fields = dataListBlock.fields as Record<string, unknown>;
    expect(fields.cardImagePosition).toBeUndefined();
    expect(fields.rowShowImage).toBeUndefined();
    expect(fields.listingImagePosition).toBeUndefined();
  });

  it("has layout option fields for cards view", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).columns.type).toBe("custom");
  });

  it("has layout option fields for rows view", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).rowDensity.type).toBe("custom");
  });

  it("has layout option fields for listing view", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).listingWidth.type).toBe("custom");
  });

  it("has list-level fields", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).heading.type).toBe("custom");
    expect(fieldsOf(dataListBlock).groupBy.type).toBe("custom");
    expect(fieldsOf(dataListBlock).sortBy.type).toBe("custom");
    expect(fieldsOf(dataListBlock).sortDir.type).toBe("custom");
    expect(fieldsOf(dataListBlock).maxItems.type).toBe("custom");
  });

  it("does not have dataSourceType or cmsTemplateId fields", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(dataListBlock.fields).not.toHaveProperty("dataSourceType");
    expect(dataListBlock.fields).not.toHaveProperty("cmsTemplateId");
  });

  it("has sensible defaultProps", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    const d = dataListBlock.defaultProps;
    expect(d.datasourceId).toBe("");
    expect(d.viewMode).toBe("grid");
    expect(d.showTitle).toBe(true);
    expect(d.showSubtitle).toBe(true);
    expect(d.showTeaser).toBe(false);
    expect(d.showImage).toBe(true);
    expect(d.showIcon).toBe(false);
    expect(d.columns).toBe(3);
    expect(d.imagePosition).toBe("top");
    expect(d.rowDensity).toBe("comfortable");
    expect(d.listingWidth).toBe("wide");
    expect(d.heading).toBe("");
    expect(d.groupBy).toBe("");
    expect(d.sortBy).toBe("");
    expect(d.sortDir).toBe("asc");
    expect(d.maxItems).toBe(0);
    expect(d.items).toBe("");
    expect(d).not.toHaveProperty("dataSourceType");
    expect(d).not.toHaveProperty("cmsTemplateId");
    expect(d).not.toHaveProperty("titleField");
    expect(d).not.toHaveProperty("imageField");
  });

  it("resolveData sets items token when datasource is selected", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    const result = await dataListBlock.resolveData(
      {
        props: {
          ...dataListBlock.defaultProps,
          datasourceId: "swapi_list",
        },
      },
      { changed: { datasourceId: true } },
    );
    expect(result.props.items).toBe("{{ swapi_list.items }}");
  });

  it("resolveData sets empty items when no datasource selected", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    const result = await dataListBlock.resolveData(
      {
        props: {
          ...dataListBlock.defaultProps,
          datasourceId: "",
        },
      },
      { changed: { datasourceId: true } },
    );
    expect(result.props.items).toBe("");
  });

  it("resolveData skips when datasourceId has not changed", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    const result = await dataListBlock.resolveData(
      {
        props: {
          ...dataListBlock.defaultProps,
          datasourceId: "swapi_list",
        },
      },
      { changed: { viewMode: true } },
    );
    expect(result.props).toEqual({});
  });

  it("exposes an imageLoading field defaulting to lazy", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(fieldsOf(dataListBlock).imageLoading.type).toBe("custom");
    expect(dataListBlock.defaultProps.imageLoading).toBe("lazy");
  });

  it("provides a render function", async () => {
    const { dataListBlock } = await import(
      "../components/puck/data-list-block"
    );
    expect(typeof dataListBlock.render).toBe("function");
  });
});
