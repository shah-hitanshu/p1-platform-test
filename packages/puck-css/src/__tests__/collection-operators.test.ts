import { describe, it, expect } from "vitest";
import {
  sortItems,
  filterItems,
  applyCollectionOperators,
  groupItems,
} from "../data/collection-operators.js";
import { viewExtractKey } from "../data/data-list-block/utils.js";

const ITEMS = [
  { title: "Banana", count: 5, date: "2025-03-01" },
  { title: "Apple", count: 12, date: "2025-01-15" },
  { title: "Cherry", count: 3, date: "2025-02-10" },
  { title: "Date", count: 8, date: "2025-04-20" },
];

describe("sortItems", () => {
  it("sorts strings alphabetically ascending", () => {
    const sorted = sortItems(ITEMS, "title", "asc");
    expect(sorted.map((i) => i.title)).toEqual([
      "Apple",
      "Banana",
      "Cherry",
      "Date",
    ]);
  });

  it("sorts strings alphabetically descending", () => {
    const sorted = sortItems(ITEMS, "title", "desc");
    expect(sorted.map((i) => i.title)).toEqual([
      "Date",
      "Cherry",
      "Banana",
      "Apple",
    ]);
  });

  it("sorts numbers numerically", () => {
    const sorted = sortItems(ITEMS, "count", "asc");
    expect(sorted.map((i) => i.count)).toEqual([3, 5, 8, 12]);
  });

  it("sorts numbers descending", () => {
    const sorted = sortItems(ITEMS, "count", "desc");
    expect(sorted.map((i) => i.count)).toEqual([12, 8, 5, 3]);
  });

  it("sorts dates as strings (ISO format works correctly)", () => {
    const sorted = sortItems(ITEMS, "date", "asc");
    expect(sorted.map((i) => i.date)).toEqual([
      "2025-01-15",
      "2025-02-10",
      "2025-03-01",
      "2025-04-20",
    ]);
  });

  it("pushes null/undefined values to the end", () => {
    const items = [
      { title: "B", val: null },
      { title: "A", val: "x" },
      { title: "C", val: undefined },
      { title: "D", val: "a" },
    ];
    const sorted = sortItems(items, "val", "asc");
    expect(sorted.map((i) => i.title)).toEqual(["D", "A", "B", "C"]);
  });

  it("returns original array when sortByField is empty", () => {
    const sorted = sortItems(ITEMS, "", "asc");
    expect(sorted).toEqual(ITEMS);
  });

  it("does not mutate the original array", () => {
    const copy = [...ITEMS];
    sortItems(ITEMS, "title", "asc");
    expect(ITEMS).toEqual(copy);
  });
});

describe("filterItems", () => {
  it("filters by case-insensitive substring match", () => {
    const filtered = filterItems(ITEMS, "title", "an");
    expect(filtered.map((i) => i.title)).toEqual(["Banana"]);
  });

  it("returns all items when filterContains is empty", () => {
    const filtered = filterItems(ITEMS, "title", "");
    expect(filtered).toEqual(ITEMS);
  });

  it("returns all items when filterField is empty", () => {
    const filtered = filterItems(ITEMS, "", "test");
    expect(filtered).toEqual(ITEMS);
  });

  it("filters numeric values by string representation", () => {
    const filtered = filterItems(ITEMS, "count", "1");
    expect(filtered.map((i) => i.title)).toEqual(["Apple"]);
  });

  it("returns empty array when nothing matches", () => {
    const filtered = filterItems(ITEMS, "title", "zzz");
    expect(filtered).toEqual([]);
  });

  it("is case insensitive", () => {
    const filtered = filterItems(ITEMS, "title", "APPLE");
    expect(filtered.map((i) => i.title)).toEqual(["Apple"]);
  });
});

describe("applyCollectionOperators", () => {
  it("applies filter, sort, and limit in sequence", () => {
    const result = applyCollectionOperators(ITEMS, {
      filterField: "title",
      filterContains: "a",
      sortBy: "title",
      sortDir: "asc",
      limit: 2,
    });
    // "a" matches Banana, Apple, Date (case-insensitive)
    // sorted asc: Apple, Banana, Date
    // limit 2: Apple, Banana
    expect(result.items.map((i: Record<string, unknown>) => i.title)).toEqual([
      "Apple",
      "Banana",
    ]);
    expect(result.totalBeforeLimit).toBe(3);
  });

  it("returns all items when no operators are specified", () => {
    const result = applyCollectionOperators(ITEMS, {});
    expect(result.items).toEqual(ITEMS);
    expect(result.totalBeforeLimit).toBe(4);
  });

  it("returns all items when limit is 0 (unlimited)", () => {
    const result = applyCollectionOperators(ITEMS, {
      sortBy: "title",
      sortDir: "asc",
      limit: 0,
    });
    expect(result.items.length).toBe(4);
    expect(result.totalBeforeLimit).toBe(4);
  });

  it("totalBeforeLimit reflects count after filter but before limit", () => {
    const result = applyCollectionOperators(ITEMS, {
      filterField: "title",
      filterContains: "e",
      limit: 1,
    });
    // "e" matches Apple, Cherry, Date = 3 items
    expect(result.totalBeforeLimit).toBe(3);
    expect(result.items.length).toBe(1);
  });

  it("applies startAt to skip items (1-indexed)", () => {
    const result = applyCollectionOperators(ITEMS, {
      sortBy: "title",
      sortDir: "asc",
      startAt: 2,
    });
    // sorted asc: Apple, Banana, Cherry, Date; startAt=2 skips Apple
    expect(result.items.map((i: Record<string, unknown>) => i.title)).toEqual([
      "Banana",
      "Cherry",
      "Date",
    ]);
  });

  it("startAt defaults to 1 (no skip)", () => {
    const result = applyCollectionOperators(ITEMS, {
      sortBy: "title",
      sortDir: "asc",
      startAt: 1,
    });
    expect(result.items.length).toBe(4);
  });

  it("startAt 0 is treated as 1 (no skip)", () => {
    const result = applyCollectionOperators(ITEMS, { startAt: 0 });
    expect(result.items.length).toBe(4);
  });

  it("startAt and limit combine correctly", () => {
    const result = applyCollectionOperators(ITEMS, {
      sortBy: "title",
      sortDir: "asc",
      startAt: 2,
      limit: 2,
    });
    // sorted: Apple, Banana, Cherry, Date; start at 2: Banana, Cherry, Date; limit 2: Banana, Cherry
    expect(result.items.map((i: Record<string, unknown>) => i.title)).toEqual([
      "Banana",
      "Cherry",
    ]);
    expect(result.totalBeforeLimit).toBe(3);
  });

  it("filters by status when provided", () => {
    const items = [
      { title: "A", metadata: { status: "published" } },
      { title: "B", metadata: { status: "scheduled" } },
      { title: "C", metadata: { status: "draft" } },
      { title: "D", metadata: { status: "published" } },
    ];
    const result = applyCollectionOperators(items, {
      status: "Published",
    });
    expect(result.items.map((i: Record<string, unknown>) => i.title)).toEqual([
      "A",
      "D",
    ]);
  });

  it("status 'Published or scheduled' includes both", () => {
    const items = [
      { title: "A", metadata: { status: "published" } },
      { title: "B", metadata: { status: "scheduled" } },
      { title: "C", metadata: { status: "draft" } },
    ];
    const result = applyCollectionOperators(items, {
      status: "Published or scheduled",
    });
    expect(result.items.map((i: Record<string, unknown>) => i.title)).toEqual([
      "A",
      "B",
    ]);
  });

  it("status 'Any status' returns all items", () => {
    const items = [
      { title: "A", metadata: { status: "published" } },
      { title: "B", metadata: { status: "draft" } },
    ];
    const result = applyCollectionOperators(items, {
      status: "Any status",
    });
    expect(result.items.length).toBe(2);
  });

  it("items without a status field pass through status filter", () => {
    const items = [
      { title: "A", metadata: { description: "no status here" } },
      { title: "B", metadata: { status: "published" } },
      { title: "C", metadata: { status: "draft" } },
    ];
    const result = applyCollectionOperators(items, {
      status: "Published",
    });
    expect(result.items.map((i: Record<string, unknown>) => i.title)).toEqual([
      "A",
      "B",
    ]);
  });

  it("falls back to a top-level status when metadata has none", () => {
    const items = [
      { title: "A", status: "published" },
      { title: "B", status: "draft" },
    ];
    const result = applyCollectionOperators(items, {
      status: "Published",
    });
    expect(result.items.map((i: Record<string, unknown>) => i.title)).toEqual([
      "A",
    ]);
  });
});

describe("groupItems", () => {
  it("returns a single unlabeled group when groupByField is empty", () => {
    const groups = groupItems(ITEMS, "");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("");
    expect(groups[0].items).toEqual(ITEMS);
  });

  it("groups items by the specified field", () => {
    const items = [
      { name: "A", category: "fruit" },
      { name: "B", category: "vegetable" },
      { name: "C", category: "fruit" },
      { name: "D", category: "vegetable" },
    ];
    const groups = groupItems(items, "category");
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("fruit");
    expect(groups[0].items.map((i) => i.name)).toEqual(["A", "C"]);
    expect(groups[1].label).toBe("vegetable");
    expect(groups[1].items.map((i) => i.name)).toEqual(["B", "D"]);
  });

  it("puts null/undefined values under '(No value)' group", () => {
    const items = [
      { name: "A", tag: "x" },
      { name: "B", tag: null },
      { name: "C", tag: undefined },
      { name: "D", tag: "x" },
    ];
    const groups = groupItems(items, "tag");
    expect(groups).toHaveLength(2);

    const xGroup = groups.find((g) => g.label === "x");
    expect(xGroup?.items.map((i) => i.name)).toEqual(["A", "D"]);

    const noValueGroup = groups.find((g) => g.label === "(No value)");
    expect(noValueGroup?.items.map((i) => i.name)).toEqual(["B", "C"]);
  });

  it("preserves item order within groups", () => {
    const items = [
      { name: "Z", type: "a" },
      { name: "A", type: "b" },
      { name: "M", type: "a" },
      { name: "B", type: "b" },
    ];
    const groups = groupItems(items, "type");
    expect(groups[0].items.map((i) => i.name)).toEqual(["Z", "M"]);
    expect(groups[1].items.map((i) => i.name)).toEqual(["A", "B"]);
  });

  it("returns empty groups array for empty input", () => {
    const groups = groupItems([], "category");
    expect(groups).toEqual([]);
  });

  it("creates one group per unique value", () => {
    const items = [
      { val: 1 },
      { val: 2 },
      { val: 3 },
      { val: 1 },
    ];
    const groups = groupItems(items, "val");
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.label)).toEqual(["1", "2", "3"]);
  });

  it("stringifies non-string field values for group labels", () => {
    const items = [
      { name: "A", count: 5 },
      { name: "B", count: 5 },
    ];
    const groups = groupItems(items, "count");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("5");
    expect(groups[0].items).toHaveLength(2);
  });
});

describe("nested field paths", () => {
  const NESTED = [
    { id: 1, metadata: { title: "Zebra", views: 3 } },
    { id: 2, metadata: { title: "Apple", views: 12 } },
    { id: 3, metadata: { title: "Mango", views: 7 } },
  ];

  it("extracts a dotted key from a nested schema-select token", () => {
    expect(viewExtractKey("{{ item.metadata.title }}")).toBe("metadata.title");
  });

  it("sorts by a nested field", () => {
    const sorted = sortItems(NESTED, "metadata.title", "asc");
    expect(sorted.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("sorts numerically by a nested field", () => {
    const sorted = sortItems(NESTED, "metadata.views", "desc");
    expect(sorted.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("filters by a nested field", () => {
    const filtered = filterItems(NESTED, "metadata.title", "app");
    expect(filtered.map((i) => i.id)).toEqual([2]);
  });

  it("groups by a nested field", () => {
    const groups = groupItems(NESTED, "metadata.title");
    expect(groups.map((g) => g.label)).toEqual(["Zebra", "Apple", "Mango"]);
  });

  it("applies nested sort and filter together through the operator pipeline", () => {
    const { items } = applyCollectionOperators(NESTED, {
      filterField: "metadata.title",
      filterContains: "a",
      sortBy: "metadata.title",
      sortDir: "asc",
    });
    expect(items.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("treats a missing nested path as absent rather than matching", () => {
    const items = [{ id: 1, metadata: { title: "A" } }, { id: 2 }];
    expect(filterItems(items, "metadata.title", "a").map((i) => i.id)).toEqual([1]);
    expect(groupItems(items, "metadata.title").map((g) => g.label)).toEqual([
      "A",
      "(No value)",
    ]);
  });

  it("does not walk prototype-polluting segments", () => {
    const items = [{ id: 1, metadata: { title: "A" } }];
    expect(groupItems(items, "__proto__.title").map((g) => g.label)).toEqual([
      "(No value)",
    ]);
  });
});
