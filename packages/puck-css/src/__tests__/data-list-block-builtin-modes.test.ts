import { describe, it, expect } from "vitest";
import { builtinModes } from "../data/data-list-block/builtin-modes.js";

describe("builtinModes", () => {
  it("has grid, table, and list modes", () => {
    expect(Object.keys(builtinModes)).toEqual(["grid", "table", "list"]);
  });

  describe("grid mode", () => {
    it('has label "Grid"', () => {
      expect(builtinModes.grid.label).toBe("Grid");
    });

    it("has a component function", () => {
      expect(typeof builtinModes.grid.component).toBe("function");
    });

    it("has image positions: top, left, right, backdrop, none", () => {
      const values = builtinModes.grid.imagePositions.map((o) => o.value);
      expect(values).toEqual(["top", "left", "right", "backdrop", "none"]);
    });

    it("has columns field", () => {
      expect(builtinModes.grid.fields?.columns).toBeDefined();
      expect(builtinModes.grid.fields?.columns.type).toBe("custom");
    });

    it("has default columns of 3", () => {
      expect(builtinModes.grid.defaultProps?.columns).toBe(3);
    });
  });

  describe("table mode", () => {
    it('has label "Table"', () => {
      expect(builtinModes.table.label).toBe("Table");
    });

    it("has a component function", () => {
      expect(typeof builtinModes.table.component).toBe("function");
    });

    it("has image positions: left, none", () => {
      const values = builtinModes.table.imagePositions.map((o) => o.value);
      expect(values).toEqual(["left", "none"]);
    });

    it("has rowDensity field", () => {
      expect(builtinModes.table.fields?.rowDensity).toBeDefined();
      expect(builtinModes.table.fields?.rowDensity.type).toBe("custom");
    });

    it('has default rowDensity of "comfortable"', () => {
      expect(builtinModes.table.defaultProps?.rowDensity).toBe("comfortable");
    });
  });

  describe("list mode", () => {
    it('has label "List"', () => {
      expect(builtinModes.list.label).toBe("List");
    });

    it("has a component function", () => {
      expect(typeof builtinModes.list.component).toBe("function");
    });

    it("has image positions: left, right, none", () => {
      const values = builtinModes.list.imagePositions.map((o) => o.value);
      expect(values).toEqual(["left", "right", "none"]);
    });

    it("has listingWidth field", () => {
      expect(builtinModes.list.fields?.listingWidth).toBeDefined();
      expect(builtinModes.list.fields?.listingWidth.type).toBe("custom");
    });

    it('has default listingWidth of "wide"', () => {
      expect(builtinModes.list.defaultProps?.listingWidth).toBe("wide");
    });
  });
});
