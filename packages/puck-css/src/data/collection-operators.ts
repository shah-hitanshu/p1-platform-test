import { getByDotPath } from "./data-list-block/utils.js";

export function sortItems<T extends Record<string, unknown>>(
  items: T[],
  sortByField: string,
  direction: "asc" | "desc",
): T[] {
  if (!sortByField) return items;

  return [...items].sort((a, b) => {
    const aVal = getByDotPath(a, sortByField);
    const bVal = getByDotPath(b, sortByField);

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    const aNum = Number(aVal);
    const bNum = Number(bVal);
    const bothNumeric = !isNaN(aNum) && !isNaN(bNum);

    let cmp: number;
    if (bothNumeric) {
      cmp = aNum - bNum;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }

    return direction === "desc" ? -cmp : cmp;
  });
}

export function filterItems<T extends Record<string, unknown>>(
  items: T[],
  filterField: string,
  filterContains: string,
): T[] {
  if (!filterField || !filterContains) return items;

  const needle = filterContains.toLowerCase();
  return items.filter((item) => {
    const val = getByDotPath(item, filterField);
    if (val == null) return false;
    return String(val).toLowerCase().includes(needle);
  });
}

function statusAllowed(
  status: string | undefined,
): string[] | null {
  if (!status || status === "Any status") return null;
  if (status === "Published") return ["published"];
  return ["published", "scheduled"];
}

export function applyCollectionOperators<T extends Record<string, unknown>>(
  items: T[],
  opts: {
    filterField?: string;
    filterContains?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    startAt?: number;
    limit?: number;
    status?: string;
  },
): { items: T[]; totalBeforeLimit: number } {
  let result = items;

  const allowed = statusAllowed(opts.status);
  if (allowed) {
    result = result.filter((item) => {
      const s = getByDotPath(item, "metadata.status") ?? item.status;
      if (s == null) return true;
      return allowed.includes(String(s).toLowerCase());
    });
  }

  if (opts.filterField && opts.filterContains) {
    result = filterItems(result, opts.filterField, opts.filterContains);
  }

  if (opts.sortBy) {
    result = sortItems(result, opts.sortBy, opts.sortDir ?? "asc");
  }

  const start = Math.max(1, opts.startAt ?? 1);
  if (start > 1) {
    result = result.slice(start - 1);
  }

  const totalBeforeLimit = result.length;

  if (opts.limit && opts.limit > 0) {
    result = result.slice(0, opts.limit);
  }

  return { items: result, totalBeforeLimit };
}

export function groupItems<T extends Record<string, unknown>>(
  items: T[],
  groupByField: string,
): { label: string; items: T[] }[] {
  if (!groupByField) {
    if (items.length === 0) return [];
    return [{ label: "", items }];
  }

  if (items.length === 0) return [];

  const groups = new Map<string, T[]>();
  for (const item of items) {
    const val = getByDotPath(item, groupByField);
    const label = val == null ? "(No value)" : String(val);
    const existing = groups.get(label);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(label, [item]);
    }
  }
  return Array.from(groups.entries()).map(([label, grouped]) => ({
    label,
    items: grouped,
  }));
}
