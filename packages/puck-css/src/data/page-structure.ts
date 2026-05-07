import {
  listRouteTemplateKeys,
  pickTemplateSourcePath,
} from "./route-templates";

import type { RouteRow } from "./page-store";

/** Table row with indentation: overrides and instance rows nest under their template. */
export type FlatStructureRow = {
  row: RouteRow;
  depth: number;
  /** Grouping row when overrides exist but the base path has no DB entry */
  synthetic?: boolean;
};

function templateKeysFromRouteRows(routes: RouteRow[]): string[] {
  const set = new Set<string>();
  for (const r of routes) {
    set.add(r.path);
    if (r.basePath) set.add(r.basePath);
  }
  return listRouteTemplateKeys(Array.from(set));
}

/**
 * Flatten routes for the structure UI: template/static roots, then children (overrides + full JSON instances).
 */
export function flattenStructureRoutes(routes: RouteRow[]): FlatStructureRow[] {
  const templateKeys = templateKeysFromRouteRows(routes);
  const overridesByBase = new Map<string, RouteRow[]>();
  for (const r of routes) {
    if (r.kind === "override" && r.basePath) {
      const list = overridesByBase.get(r.basePath) ?? [];
      list.push(r);
      overridesByBase.set(r.basePath, list);
    }
  }
  for (const [, list] of Array.from(overridesByBase.entries())) {
    list.sort((a, b) => a.path.localeCompare(b.path));
  }

  const templateInstances = routes.filter(
    (r) =>
      r.kind === "instance-full" && pickTemplateSourcePath(r.path, templateKeys) !== null
  );
  templateInstances.sort((a, b) => a.path.localeCompare(b.path));

  const topLevel: RouteRow[] = [];
  for (const r of routes) {
    if (r.kind === "override") {
      continue;
    }
    if (templateInstances.some((j) => j.path === r.path)) {
      continue;
    }
    topLevel.push(r);
  }
  topLevel.sort((a, b) => a.path.localeCompare(b.path));

  const out: FlatStructureRow[] = [];
  const emittedChildPaths = new Set<string>();

  function pushChildrenOf(parentPath: string): void {
    const merged: RouteRow[] = [];
    for (const inst of templateInstances) {
      if (pickTemplateSourcePath(inst.path, templateKeys) === parentPath) {
        merged.push(inst);
      }
    }
    merged.push(...(overridesByBase.get(parentPath) ?? []));
    merged.sort((a, b) => a.path.localeCompare(b.path));
    for (const c of merged) {
      out.push({ row: c, depth: 1 });
      emittedChildPaths.add(c.path);
    }
  }

  const emittedBasesWithChildren = new Set<string>();

  for (const r of topLevel) {
    out.push({ row: r, depth: 0 });
    pushChildrenOf(r.path);
    emittedBasesWithChildren.add(r.path);
  }

  for (const [basePath, kids] of Array.from(overridesByBase.entries())) {
    if (emittedBasesWithChildren.has(basePath)) {
      continue;
    }
    out.push({
      row: {
        path: basePath,
        kind: "template",
        patchOperations: 0,
      },
      depth: 0,
      synthetic: true,
    });
    for (const c of kids) {
      out.push({ row: c, depth: 1 });
      emittedChildPaths.add(c.path);
    }
    for (const inst of templateInstances) {
      if (
        pickTemplateSourcePath(inst.path, templateKeys) === basePath &&
        !emittedChildPaths.has(inst.path)
      ) {
        out.push({ row: inst, depth: 1 });
        emittedChildPaths.add(inst.path);
      }
    }
    emittedBasesWithChildren.add(basePath);
  }

  for (const inst of templateInstances) {
    if (!emittedChildPaths.has(inst.path)) {
      out.push({ row: inst, depth: 0 });
    }
  }

  return out;
}
