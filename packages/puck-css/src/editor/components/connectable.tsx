import type { ComponentType } from "react";

export type ConnectableItem = Record<string, unknown>;

export type ConnectedItem = ConnectableItem & {
  _title: string;
  _href?: string;
  _index: number;
};

type ConnectableInputProps = {
  items?: unknown;
  itemTitleTemplate?: string;
  itemUrlTemplate?: string;
  min?: number;
  max?: number;
};

/** Walk a dotted path (e.g. "address.city") into a datasource row object. */
function getItemPath(item: ConnectableItem, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".");
  let cur: unknown = item;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Interpolate `{{ item.field }}` and `{{ index }}` placeholders in a template string. */
export function renderItemTemplate(
  template: string,
  item: ConnectableItem,
  index: number,
): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_m, rawInner: string) => {
    const inner = rawInner.trim();
    if (inner === "index") return String(index);
    if (inner === "item") return "";
    if (inner.startsWith("item.")) {
      const value = getItemPath(item, inner.slice("item.".length));
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return String(value);
      }
    }
    return "";
  });
}

/** Render a URL template and return it only if it looks like a safe href (relative or http). */
function toSafeHref(
  template: string,
  item: ConnectableItem,
  index: number,
): string | undefined {
  const localRendered = renderItemTemplate(template, item, index);
  const id = String(item.id ?? "");
  const name = String(item.name ?? "");
  const out = localRendered
    .replace(/\{id\}/g, encodeURIComponent(id))
    .replace(/\{name\}/g, encodeURIComponent(name));
  if (!out.trim()) return undefined;
  if (
    out.startsWith("/") ||
    out.startsWith("./") ||
    /^https?:\/\//i.test(out)
  ) {
    return out;
  }
  return undefined;
}

/** Slice raw items to [min, max], resolve title/href templates, and produce ConnectedItem[]. */
function normalizeConnectedItems(
  items: unknown,
  itemTitleTemplate: string,
  itemUrlTemplate: string,
  min: number,
  max: number,
): ConnectedItem[] {
  const raw = Array.isArray(items) ? items : [];
  const minItems = Number.isFinite(min) ? Math.max(0, Math.trunc(min)) : 0;
  const maxItems = Number.isFinite(max)
    ? Math.max(0, Math.trunc(max))
    : raw.length;
  const upper = Math.max(minItems, maxItems);
  return raw.slice(0, upper).map((row, index) => {
    const item =
      row && typeof row === "object" && !Array.isArray(row)
        ? (row as ConnectableItem)
        : {};
    const title = renderItemTemplate(itemTitleTemplate, item, index).trim();
    const fallbackName = String(item.name ?? "").trim();
    const fallbackId = String(item.id ?? "").trim();
    return {
      ...item,
      _index: index,
      _title:
        title || fallbackName || (fallbackId ? `Item #${fallbackId}` : "Item"),
      _href: toSafeHref(itemUrlTemplate, item, index),
    };
  });
}

/** HOC that wraps a component expecting `ConnectedItem[]` with datasource template resolution. */
export function Connectable<TBaseProps extends { items: ConnectedItem[] }>(
  Base: ComponentType<TBaseProps>,
) {
  type Props = Omit<TBaseProps, "items"> & ConnectableInputProps;

  return function ConnectableComponent(props: Props) {
    const itemsInput = props.items;
    const titleTemplate = (props.itemTitleTemplate || "{{ item.name }}").trim();
    const urlTemplate = (props.itemUrlTemplate || "").trim();
    const items = normalizeConnectedItems(
      itemsInput,
      titleTemplate,
      urlTemplate,
      props.min ?? 0,
      props.max ?? Number.MAX_SAFE_INTEGER,
    );
    return <Base {...({ ...props, items } as TBaseProps)} />;
  };
}
