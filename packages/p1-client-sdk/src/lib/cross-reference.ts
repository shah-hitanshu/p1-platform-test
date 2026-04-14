import type { Config, Data } from "@puckeditor/core";

import { isComponentNode, stripTrailingSlash } from "./paths";

/**
 * Matches `{{ pages["/path"].blocks["blockId"].props.propOr.nested }}`.
 * Path and block id are JSON string literals (same as `JSON.stringify`).
 */
export const CROSS_PAGE_REF_REGEX =
  /\{\{\s*pages\[("[^"\\]*(?:\\.[^"\\]*)*")\]\.blocks\[("[^"\\]*(?:\\.[^"\\]*)*")\]\.props\.([\w.]+)\s*\}\}/g;

const CONNECTABLE_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "number",
  "select",
  "radio",
]);

export const MAX_XREF_DEPTH = 10;

function findPropsByIdInNodes(nodes: unknown, id: string): Record<string, unknown> | null {
  if (!Array.isArray(nodes)) return null;
  for (const item of nodes) {
    if (!isComponentNode(item)) continue;
    const props = item.props;
    if (props.id === id) return props;
    for (const val of Object.values(props)) {
      if (Array.isArray(val)) {
        const found = findPropsByIdInNodes(val, id);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Full saved props for a block by `props.id`, or root field props for `root` / `puck-root`.
 */
export function getBlockPropsById(data: Data, componentId: string): Record<string, unknown> | null {
  if (componentId === "root" || componentId === "puck-root") {
    const root = data.root as Record<string, unknown> | undefined;
    if (!root) return null;
    const nested = root.props as Record<string, unknown> | undefined;
    if (nested) return { ...nested };
    return { ...root };
  }

  const fromContent = findPropsByIdInNodes(data.content, componentId);
  if (fromContent) return { ...fromContent };

  const zones = data.zones;
  if (zones && typeof zones === "object") {
    for (const z of Object.values(zones)) {
      const fz = findPropsByIdInNodes(z, componentId);
      if (fz) return { ...fz };
    }
  }

  return null;
}

function getPropFromObject(obj: Record<string, unknown>, propPath: string): unknown {
  const parts = propPath.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Raw prop value from saved Puck data (string/number/boolean or undefined).
 * `propPath` may be dotted (e.g. `meta.alt`).
 */
export function getRawPropValue(data: Data, componentId: string, propPath: string): unknown {
  if (componentId === "root") {
    const root = data.root as Record<string, unknown> | undefined;
    if (!root) return undefined;
    const nested = root.props as Record<string, unknown> | undefined;
    if (nested) {
      const v = getPropFromObject(nested, propPath);
      if (v !== undefined) return v;
    }
    return getPropFromObject(root, propPath);
  }

  const fromContent = findPropsByIdInNodes(data.content, componentId);
  if (fromContent) {
    const v = getPropFromObject(fromContent as Record<string, unknown>, propPath);
    if (v !== undefined) return v;
  }

  const zones = data.zones;
  if (zones && typeof zones === "object") {
    for (const z of Object.values(zones)) {
      const fromZ = findPropsByIdInNodes(z, componentId);
      if (fromZ) {
        const v = getPropFromObject(fromZ as Record<string, unknown>, propPath);
        if (v !== undefined) return v;
      }
    }
  }

  return undefined;
}

export function normalizeRoutePathForRef(p: string): string {
  return stripTrailingSlash(p);
}

/**
 * Human-readable cross-page reference, e.g.
 * `{{ pages["/"].blocks["ImageBlock-uuid"].props.src }}`
 */
export function encodePagesBlocksTemplate(path: string, blockId: string, propKey: string): string {
  const p = normalizeRoutePathForRef(path);
  return `{{ pages[${JSON.stringify(p)}].blocks[${JSON.stringify(blockId)}].props.${propKey} }}`;
}

export function isPagesBlocksTemplateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.search(CROSS_PAGE_REF_REGEX) !== -1;
}

export function isCrossPageRefTemplateString(value: unknown): boolean {
  return isPagesBlocksTemplateString(value);
}

export type FlatComponent = { id: string; type: string; label: string };

function walkNodes(nodes: unknown, config: Config, out: FlatComponent[]): void {
  if (!Array.isArray(nodes)) return;
  for (const item of nodes) {
    if (!isComponentNode(item)) continue;
    const { type, props } = item;
    const id = typeof props.id === "string" ? props.id : "?";
    const compConf = config.components[type as keyof typeof config.components] as { label?: string } | undefined;
    const labelBase = compConf?.label ?? type;
    out.push({
      id,
      type,
      label: `${labelBase} · ${id.length > 14 ? `${id.slice(0, 12)}…` : id}`,
    });
    for (const val of Object.values(props)) {
      if (Array.isArray(val)) walkNodes(val, config, out);
    }
  }
}

export function flattenComponents(data: Data, config: Config): FlatComponent[] {
  const out: FlatComponent[] = [{ id: "root", type: "root", label: "Page root" }];
  walkNodes(data.content, config, out);
  const zones = data.zones;
  if (zones && typeof zones === "object") {
    for (const z of Object.values(zones)) {
      walkNodes(z, config, out);
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

export function listConnectablePropKeys(config: Config, componentType: string): string[] {
  if (componentType === "root") {
    const fields = config.root?.fields;
    if (!fields) return [];
    return Object.entries(fields)
      .filter(([, f]) => {
        const t = (f as { type?: string })?.type;
        return typeof t === "string" && CONNECTABLE_FIELD_TYPES.has(t);
      })
      .map(([k]) => k);
  }
  const comp = config.components[componentType as keyof typeof config.components] as
    | { fields?: Record<string, { type?: string }> }
    | undefined;
  if (!comp?.fields) return [];
  return Object.entries(comp.fields)
    .filter(([, f]) => {
      const t = f?.type;
      return typeof t === "string" && CONNECTABLE_FIELD_TYPES.has(t);
    })
    .map(([k]) => k);
}

