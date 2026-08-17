import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockSelectedItem: { type: string; props: Record<string, unknown> } | null =
  null;
const mockDispatch = vi.fn();
const mockGetItemById = vi.fn();
const mockGetSelectorForId = vi.fn();

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => {
    return (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        selectedItem: mockSelectedItem,
        dispatch: mockDispatch,
        getItemById: mockGetItemById,
        getSelectorForId: mockGetSelectorForId,
      });
  },
  FieldLabel: ({
    children,
    label,
  }: {
    children?: React.ReactNode;
    label: string;
  }) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
}));

vi.mock("@pantheon-systems/pds-toolkit-react", () => ({
  Switch: ({
    id,
    label,
    checked,
    onChange,
  }: {
    id?: string;
    label?: string;
    checked?: boolean;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      aria-label={label}
      checked={checked}
      onChange={onChange}
    />
  ),
  SegmentedButton: ({
    options,
    value,
    onChange,
  }: {
    options?: { label: string; value: string }[];
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <div role="group">
      {options?.map((opt) => (
        <button
          key={opt.value}
          aria-pressed={opt.value === value}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ),
  Select: ({
    value,
    options,
    onOptionSelect,
    disabled,
  }: {
    value?: string;
    options?: { label: string; value: string }[];
    onOptionSelect?: (opt: { label: string; value: string }) => void;
    disabled?: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
        const opt = options?.find((o) => o.value === e.target.value);
        if (opt && onOptionSelect) onOptionSelect(opt);
      }}
    >
      {options?.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  ),
}));

import { createDataListBlock } from "../data/data-list-block/create-data-list-block.js";
import { builtinModes } from "../data/data-list-block/builtin-modes.js";
import {
  DatasourceRegistryProvider,
  DatasourceDataProvider,
} from "../data/fields/datasource-select-field.js";
import type { LayoutProps } from "../data/data-list-block/types.js";
import type { RemoteDatasourceDefinition } from "../data/remote-datasources/remote-datasource-registry.js";

describe("createDataListBlock", () => {
  beforeEach(() => {
    mockSelectedItem = null;
    mockDispatch.mockClear();
    mockGetItemById.mockReset();
    mockGetSelectorForId.mockReset();
  });

  describe("no-arg call (backwards compatible)", () => {
    it('returns config with label "List"', () => {
      const block = createDataListBlock();
      expect(block.label).toBe("List");
    });

    it("has a viewMode custom field backed by SegmentedButton", () => {
      const block = createDataListBlock();
      expect(block.fields.viewMode.type).toBe("custom");
      expect(block.fields.viewMode.render).toBeDefined();
    });

    it("has common fields: datasourceId, titleField, subtitleField, teaserField, imageField, iconField", () => {
      const block = createDataListBlock();
      expect(block.fields.datasourceId).toBeDefined();
      expect(block.fields.titleField).toBeDefined();
      expect(block.fields.subtitleField).toBeDefined();
      expect(block.fields.teaserField).toBeDefined();
      expect(block.fields.imageField).toBeDefined();
      expect(block.fields.iconField).toBeDefined();
    });

    it("has imagePosition custom field", () => {
      const block = createDataListBlock();
      expect(block.fields.imagePosition).toBeDefined();
      expect(block.fields.imagePosition.type).toBe("custom");
    });

    describe("imageLoading field visibility", () => {
      function renderImageLoading(props: Record<string, unknown>) {
        mockSelectedItem = { type: "DataListBlock", props };
        const field = createDataListBlock().fields.imageLoading;
        return render(
          field.render({
            field,
            name: "imageLoading",
            id: "field-imageLoading",
            label: field.label,
            value: props.imageLoading ?? "",
            onChange: () => {},
          }),
        );
      }

      it("shows the field for documents saved before it existed", () => {
        renderImageLoading({ id: "DL-1" });
        expect(screen.getByText("Eager")).toBeInTheDocument();
      });

      it("defaults the control to Lazy when no value is stored", () => {
        renderImageLoading({ id: "DL-1" });
        expect(screen.getByText("Lazy")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });

      it("hides the field when images are turned off", () => {
        const { container } = renderImageLoading({
          id: "DL-1",
          showImage: false,
        });
        expect(container.innerHTML).toBe("");
      });
    });

    it("has per-mode fields from all built-in modes", () => {
      const block = createDataListBlock();
      expect(block.fields.columns).toBeDefined();
      expect(block.fields.rowDensity).toBeDefined();
      expect(block.fields.listingWidth).toBeDefined();
    });

    it("has heading, groupBy, sortBy, sortDir, maxItems fields", () => {
      const block = createDataListBlock();
      expect(block.fields.heading).toBeDefined();
      expect(block.fields.groupBy).toBeDefined();
      expect(block.fields.sortBy).toBeDefined();
      expect(block.fields.sortDir).toBeDefined();
      expect(block.fields.maxItems).toBeDefined();
    });

    it("does not expose items as a Puck field (prevents resolveData override)", () => {
      const block = createDataListBlock();
      expect(block.fields.items).toBeUndefined();
    });

    it('defaults viewMode to "grid"', () => {
      const block = createDataListBlock();
      expect(block.defaultProps.viewMode).toBe("grid");
    });

    it("has correct default props for all built-in modes", () => {
      const block = createDataListBlock();
      expect(block.defaultProps.columns).toBe(3);
      expect(block.defaultProps.rowDensity).toBe("comfortable");
      expect(block.defaultProps.listingWidth).toBe("wide");
    });

    it('defaults imagePosition to "top"', () => {
      const block = createDataListBlock();
      expect(block.defaultProps.imagePosition).toBe("top");
    });

    it("has a render function", () => {
      const block = createDataListBlock();
      expect(typeof block.render).toBe("function");
    });

    it("has a resolveData function", () => {
      const block = createDataListBlock();
      expect(typeof block.resolveData).toBe("function");
    });
  });

  describe("custom label", () => {
    it("overrides the block label", () => {
      const block = createDataListBlock({ label: "Data Grid" });
      expect(block.label).toBe("Data Grid");
    });
  });

  describe("disabling a mode", () => {
    it("omits the disabled mode from viewMode field", () => {
      const { table: _, ...rest } = builtinModes;
      const block = createDataListBlock({ modes: rest });
      expect(block.fields.viewMode.type).toBe("custom");
      expect(block.defaultProps.viewMode).toBe("grid");
    });

    it("omits the disabled mode's fields", () => {
      const { table: _, ...rest } = builtinModes;
      const block = createDataListBlock({ modes: rest });
      expect(block.fields.rowDensity).toBeUndefined();
    });

    it("omits the disabled mode's default props", () => {
      const { table: _, ...rest } = builtinModes;
      const block = createDataListBlock({ modes: rest });
      expect(block.defaultProps.rowDensity).toBeUndefined();
    });
  });

  describe("adding a custom mode", () => {
    const customModes = {
      ...builtinModes,
      datatable: {
        label: "Data Table",
        component: (props: LayoutProps & { imagePosition: string; striped: boolean }) => (
          <table data-testid="custom-table">
            <tbody>
              {props.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
        imagePositions: [{ label: "None", value: "none" as const }],
        fields: {
          striped: {
            type: "radio" as const,
            label: "Striped",
            options: [
              { label: "Yes", value: true },
              { label: "No", value: false },
            ],
          },
        },
        defaultProps: { striped: false },
      },
    };

    it("includes the custom mode in viewMode field", () => {
      const block = createDataListBlock({ modes: customModes });
      expect(block.fields.viewMode.type).toBe("custom");
      expect(block.defaultProps.viewMode).toBe("grid");
    });

    it("includes the custom mode's fields", () => {
      const block = createDataListBlock({ modes: customModes });
      expect(block.fields.striped).toBeDefined();
      expect(block.fields.striped.type).toBe("radio");
    });

    it("includes the custom mode's default props", () => {
      const block = createDataListBlock({ modes: customModes });
      expect(block.defaultProps.striped).toBe(false);
    });

    it("custom mode label is passed through to viewMode field", () => {
      const block = createDataListBlock({ modes: customModes });
      expect(block.fields.viewMode.label).toBe("View mode");
    });
  });

  describe("overriding a mode's component", () => {
    it("uses the override component in render", () => {
      const CustomCards = (props: LayoutProps & { imagePosition: string; columns: number }) => (
        <div data-testid="custom-cards">
          {props.items.map((item, i) => (
            <div key={i}>{item.title}</div>
          ))}
        </div>
      );
      const block = createDataListBlock({
        modes: {
          ...builtinModes,
          grid: { ...builtinModes.grid, component: CustomCards },
        },
      });
      const Render = block.render;
      render(
        <Render
          datasourceId="test"
          viewMode="grid"
          items={JSON.stringify([{ name: "Item1" }])}
          titleField="{{ item.name }}"
          subtitleField=""
          teaserField=""
          imageField=""
          iconField=""
          showTitle={true}
          showSubtitle={false}
          showTeaser={false}
          showImage={false}
          showIcon={false}
          columns={3}
          imagePosition="top"
          heading=""

          groupBy=""
          sortBy=""
          sortDir="asc"
          maxItems={0}
        />,
      );
      expect(screen.getByTestId("custom-cards")).toBeTruthy();
      expect(screen.getByText("Item1")).toBeTruthy();
    });
  });

  describe("first mode is default", () => {
    it("defaults viewMode to the first mode key", () => {
      const block = createDataListBlock({
        modes: {
          list: builtinModes.list,
          grid: builtinModes.grid,
        },
      });
      expect(block.defaultProps.viewMode).toBe("list");
    });

    it("defaults imagePosition to the first position of the first mode", () => {
      const block = createDataListBlock({
        modes: {
          list: builtinModes.list,
          grid: builtinModes.grid,
        },
      });
      expect(block.defaultProps.imagePosition).toBe("left");
    });
  });

  describe("resolveData", () => {
    it("sets items template token when datasourceId changes", async () => {
      const block = createDataListBlock();
      const result = await block.resolveData(
        { props: { datasourceId: "swapi_list" } },
        { changed: { datasourceId: true } },
      );
      expect(result.props.items).toBe("{{ swapi_list.items }}");
    });

    it("clears items when datasourceId is empty", async () => {
      const block = createDataListBlock();
      const result = await block.resolveData(
        { props: { datasourceId: "" } },
        { changed: { datasourceId: true } },
      );
      expect(result.props.items).toBe("");
    });

    it("returns empty props when datasourceId has not changed", async () => {
      const block = createDataListBlock();
      const result = await block.resolveData(
        { props: { datasourceId: "swapi_list" } },
        { changed: { viewMode: true } },
      );
      expect(result.props).toEqual({});
    });
  });

  describe("field auto-mapping", () => {
    const ITEMS = [
      { name: "Bulbasaur", description: "Seed Pokemon", image_url: "bulbasaur.png" },
      { name: "Charmander", description: "Lizard Pokemon", image_url: "charmander.png" },
    ];

    function renderWithProviders(
      props: Record<string, unknown>,
      context: Record<string, unknown> = {},
      registry: RemoteDatasourceDefinition[] = [],
    ) {
      const block = createDataListBlock();
      const Render = block.render;
      return render(
        <DatasourceRegistryProvider registry={registry}>
          <DatasourceDataProvider context={context}>
            <Render {...props} />
          </DatasourceDataProvider>
        </DatasourceRegistryProvider>,
      );
    }

    it("auto-maps title from runtime data when titleField is empty", () => {
      renderWithProviders(
        {
          datasourceId: "pokemon_list",
          viewMode: "grid",
          items: JSON.stringify(ITEMS),
          showTitle: true,
          showSubtitle: true,
          showTeaser: false,
          showImage: false,
          showIcon: false,
          columns: 3,
          imagePosition: "top",
          heading: "",
          groupBy: "",
          startAt: 1,
          status: "Published",
          sortBy: "",
          sortDir: "asc",
          filterField: "",
          filterContains: "",
          maxItems: 0,
        },
        { pokemon_list: { items: ITEMS } },
      );
      expect(screen.getByText("Bulbasaur")).toBeTruthy();
      expect(screen.getByText("Charmander")).toBeTruthy();
    });

    it("auto-maps image from registry fields when imageField is empty", () => {
      const registry: RemoteDatasourceDefinition[] = [
        {
          id: "pokemon_list",
          label: "Pokemon",
          description: "Pokemon list",
          resolution: "static",
          fields: [
            { path: "items.0.name", description: "Name" },
            { path: "items.0.image_url", description: "Image URL" },
          ],
        },
      ];
      renderWithProviders(
        {
          datasourceId: "pokemon_list",
          viewMode: "grid",
          items: JSON.stringify(ITEMS),
          showTitle: true,
          showSubtitle: false,
          showTeaser: false,
          showImage: true,
          showIcon: false,
          columns: 3,
          imagePosition: "top",
          heading: "",
          groupBy: "",
          startAt: 1,
          status: "Published",
          sortBy: "",
          sortDir: "asc",
          filterField: "",
          filterContains: "",
          maxItems: 0,
        },
        { pokemon_list: { items: ITEMS } },
        registry,
      );
      const images = screen.getAllByRole("img");
      expect(images.length).toBeGreaterThan(0);
      expect(images[0].getAttribute("src")).toBe("bulbasaur.png");
    });

    it("auto-maps from resolved items array without datasource context", () => {
      renderWithProviders(
        {
          datasourceId: "pokemon_list",
          viewMode: "grid",
          items: ITEMS,
          showTitle: true,
          showSubtitle: true,
          showTeaser: false,
          showImage: false,
          showIcon: false,
          columns: 3,
          imagePosition: "top",
          heading: "",
          groupBy: "",
          startAt: 1,
          status: "Published",
          sortBy: "",
          sortDir: "asc",
          filterField: "",
          filterContains: "",
          maxItems: 0,
        },
        {},
      );
      expect(screen.getByText("Bulbasaur")).toBeTruthy();
      expect(screen.getByText("Charmander")).toBeTruthy();
    });

    it("does not override user-set field mappings", () => {
      renderWithProviders(
        {
          datasourceId: "pokemon_list",
          viewMode: "grid",
          items: JSON.stringify(ITEMS),
          titleField: "{{ item.description }}",
          showTitle: true,
          showSubtitle: false,
          showTeaser: false,
          showImage: false,
          showIcon: false,
          columns: 3,
          imagePosition: "top",
          heading: "",
          groupBy: "",
          startAt: 1,
          status: "Published",
          sortBy: "",
          sortDir: "asc",
          filterField: "",
          filterContains: "",
          maxItems: 0,
        },
        { pokemon_list: { items: ITEMS } },
      );
      expect(screen.getByText("Seed Pokemon")).toBeTruthy();
      expect(screen.queryByText("Bulbasaur")).toBeNull();
    });

    it("keeps a field cleared when the user selects None", () => {
      renderWithProviders(
        {
          datasourceId: "pokemon_list",
          viewMode: "grid",
          items: JSON.stringify(ITEMS),
          titleField: "",
          showTitle: true,
          showSubtitle: false,
          showTeaser: false,
          showImage: false,
          showIcon: false,
          columns: 3,
          imagePosition: "top",
          heading: "",
          groupBy: "",
          startAt: 1,
          status: "Published",
          sortBy: "",
          sortDir: "asc",
          filterField: "",
          filterContains: "",
          maxItems: 0,
        },
        { pokemon_list: { items: ITEMS } },
      );
      expect(screen.queryByText("Bulbasaur")).toBeNull();
    });

    it("does not apply the status filter to non-template datasources", () => {
      const rows = [
        { name: "Open one", status: "open" },
        { name: "Closed one", status: "closed" },
      ];
      renderWithProviders(
        {
          datasourceId: "tickets",
          viewMode: "grid",
          items: JSON.stringify(rows),
          showTitle: true,
          showSubtitle: false,
          showTeaser: false,
          showImage: false,
          showIcon: false,
          columns: 3,
          imagePosition: "top",
          heading: "",
          groupBy: "",
          startAt: 1,
          status: "Published",
          sortBy: "",
          sortDir: "asc",
          filterField: "",
          filterContains: "",
          maxItems: 0,
        },
        { tickets: { items: rows } },
      );
      expect(screen.getByText("Open one")).toBeTruthy();
      expect(screen.getByText("Closed one")).toBeTruthy();
    });
  });

  describe("render pipeline", () => {
    it("shows placeholder when datasourceId is empty", () => {
      const block = createDataListBlock();
      const Render = block.render;
      render(
        <Render
          datasourceId=""
          viewMode="grid"
          items=""
          titleField=""
          subtitleField=""
          teaserField=""
          imageField=""
          iconField=""
          showTitle={true}
          showSubtitle={false}
          showTeaser={false}
          showImage={false}
          showIcon={false}
          columns={3}
          imagePosition="top"
          heading=""

          groupBy=""
          sortBy=""
          sortDir="asc"
          maxItems={0}
        />,
      );
      expect(
        screen.getByText("Select a datasource to display items"),
      ).toBeTruthy();
    });

    it("renders items using the correct mode component", () => {
      const block = createDataListBlock();
      const Render = block.render;
      render(
        <Render
          datasourceId="test"
          viewMode="grid"
          items={JSON.stringify([{ name: "Luke" }])}
          titleField="{{ item.name }}"
          subtitleField=""
          teaserField=""
          imageField=""
          iconField=""
          showTitle={true}
          showSubtitle={false}
          showTeaser={false}
          showImage={false}
          showIcon={false}
          columns={3}
          imagePosition="top"
          heading=""

          groupBy=""
          sortBy=""
          sortDir="asc"
          maxItems={0}
        />,
      );
      expect(screen.getByText("Luke")).toBeTruthy();
    });

    it("renders heading when heading prop is non-empty", () => {
      const block = createDataListBlock();
      const Render = block.render;
      render(
        <Render
          datasourceId="test"
          viewMode="grid"
          items={JSON.stringify([{ name: "Luke" }])}
          titleField="{{ item.name }}"
          subtitleField=""
          teaserField=""
          imageField=""
          iconField=""
          showTitle={true}
          showSubtitle={false}
          showTeaser={false}
          showImage={false}
          showIcon={false}
          columns={3}
          imagePosition="top"
          heading="My Heading"
          groupBy=""
          sortBy=""
          sortDir="asc"
          maxItems={0}
        />,
      );
      expect(screen.getByText("My Heading")).toBeTruthy();
    });
  });
});
