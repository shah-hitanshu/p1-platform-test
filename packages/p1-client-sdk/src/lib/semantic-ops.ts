import type { Data } from "@puckeditor/core";
import { deepClone } from "fast-json-patch";

import { isUnsafeKey } from "./paths";

/** Block identity for stable overrides (Puck `props.id`). */
export type SemanticOp =
  | { op: "setRootProp"; propPath: string; value: unknown }
  | { op: "removeRootProp"; propPath: string }
  | { op: "setProp"; blockId: string; propPath: string; value: unknown }
  | { op: "removeProp"; blockId: string; propPath: string }
  | {
      op: "moveBlock";
      blockId: string;
      /** `"content"` or a zone name */
      slot: string;
      /** Previous sibling id in that slot; `null` = first */
      afterId: string | null;
    }
  | {
      op: "addBlock";
      block: { type: string; props: Record<string, unknown> };
      slot: string;
      afterId: string | null;
    }
  | { op: "removeBlock"; blockId: string };

type PuckBlock = { type: string; props: Record<string, unknown> };

function getBlockId(block: PuckBlock): string | null {
  const id = block.props?.id;
  if (id === undefined || id === null) {
    return null;
  }
  const s = String(id);
  return s.length > 0 ? s : null;
}

function getRootProps(data: Data): Record<string, unknown> {
  const root = data.root as Record<string, unknown>;
  if (
    root.props &&
    typeof root.props === "object" &&
    !Array.isArray(root.props)
  ) {
    return root.props as Record<string, unknown>;
  }
  return root as Record<string, unknown>;
}

function setDeep(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".");
  if (parts.some(isUnsafeKey)) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (
      next == null ||
      typeof next !== "object" ||
      Array.isArray(next)
    ) {
      const fresh: Record<string, unknown> = Object.create(null);
      cur[p] = fresh;
      cur = fresh;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  const lastKey = parts[parts.length - 1];
  if (isUnsafeKey(lastKey)) return;
  cur[lastKey] = value as never;
}

function deleteDeep(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  if (parts.some((k) => isUnsafeKey(k))) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (isUnsafeKey(p)) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(cur, p)) {
      return;
    }
    const next = (cur as Record<string, unknown>)[p];
    if (next == null || typeof next !== "object") {
      return;
    }
    cur = next as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  if (isUnsafeKey(lastKey)) return;
  if (!Object.prototype.hasOwnProperty.call(cur, lastKey)) {
    return;
  }
  delete (cur as Record<string, unknown>)[lastKey];
}

function listSlots(data: Data): string[] {
  const slots = new Set<string>(["content"]);
  for (const k of Object.keys(data.zones ?? {})) {
    slots.add(k);
  }
  return Array.from(slots);
}

function getSlotArray(data: Data, slot: string): PuckBlock[] {
  if (slot === "content") {
    return (data.content ?? []) as PuckBlock[];
  }
  return ((data.zones ?? {})[slot] ?? []) as PuckBlock[];
}

function setSlotArray(data: Data, slot: string, arr: PuckBlock[]): void {
  if (slot === "content") {
    (data as { content: PuckBlock[] }).content = arr;
    return;
  }
  if (!data.zones) {
    (data as { zones: Record<string, PuckBlock[]> }).zones = {};
  }
  data.zones![slot] = arr as never;
}

function afterIdForIndex(items: PuckBlock[], index: number): string | null {
  if (index <= 0) {
    return null;
  }
  return getBlockId(items[index - 1]);
}

type Placed = { slot: string; afterId: string | null; block: PuckBlock };

function flattenPlaced(data: Data): Placed[] {
  const out: Placed[] = [];
  const content = getSlotArray(data, "content");
  content.forEach((block, i) => {
    out.push({
      slot: "content",
      afterId: afterIdForIndex(content, i),
      block,
    });
  });
  for (const slot of Object.keys(data.zones ?? {})) {
    const items = getSlotArray(data, slot);
    items.forEach((block, i) => {
      out.push({
        slot,
        afterId: afterIdForIndex(items, i),
        block,
      });
    });
  }
  return out;
}

function buildPlacementMap(data: Data): Map<string, Placed> {
  const map = new Map<string, Placed>();
  for (const p of flattenPlaced(data)) {
    const id = getBlockId(p.block);
    if (id) {
      map.set(id, p);
    }
  }
  return map;
}

function removeBlockFromData(data: Data, blockId: string): PuckBlock | null {
  for (const slot of listSlots(data)) {
    const arr = getSlotArray(data, slot);
    const i = arr.findIndex((b) => getBlockId(b) === blockId);
    if (i !== -1) {
      const [removed] = arr.splice(i, 1);
      setSlotArray(data, slot, arr);
      return removed;
    }
  }
  return null;
}

function insertBlockInSlot(
  data: Data,
  slot: string,
  block: PuckBlock,
  afterId: string | null
): void {
  const arr = [...getSlotArray(data, slot)];
  if (afterId === null) {
    arr.unshift(block);
  } else {
    const idx = arr.findIndex((b) => getBlockId(b) === afterId);
    if (idx === -1) {
      arr.push(block);
    } else {
      arr.splice(idx + 1, 0, block);
    }
  }
  setSlotArray(data, slot, arr);
}

function findBlock(data: Data, blockId: string): PuckBlock | null {
  for (const slot of listSlots(data)) {
    const found = getSlotArray(data, slot).find(
      (b) => getBlockId(b) === blockId
    );
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Apply semantic ops in order on a deep clone of `base`.
 */
export function applySemanticOps(base: Data, ops: SemanticOp[]): Data {
  const data = deepClone(base) as Data;

  for (const op of ops) {
    switch (op.op) {
      case "setRootProp": {
        const props = getRootProps(data);
        setDeep(props, op.propPath, op.value);
        break;
      }
      case "removeRootProp": {
        const props = getRootProps(data);
        deleteDeep(props, op.propPath);
        break;
      }
      case "setProp": {
        const block = findBlock(data, op.blockId);
        if (!block) {
          break;
        }
        setDeep(block.props, op.propPath, op.value);
        break;
      }
      case "removeProp": {
        const block = findBlock(data, op.blockId);
        if (!block) {
          break;
        }
        deleteDeep(block.props, op.propPath);
        break;
      }
      case "removeBlock": {
        removeBlockFromData(data, op.blockId);
        break;
      }
      case "moveBlock": {
        const block = removeBlockFromData(data, op.blockId);
        if (!block) {
          break;
        }
        insertBlockInSlot(data, op.slot, block, op.afterId);
        break;
      }
      case "addBlock": {
        insertBlockInSlot(data, op.slot, op.block as PuckBlock, op.afterId);
        break;
      }
    }
  }

  return data;
}

type DiffOpFactory = {
  set(propPath: string, value: unknown): SemanticOp;
  remove(propPath: string): SemanticOp;
  skipKey?: string;
};

function diffProps(
  base: Record<string, unknown>,
  target: Record<string, unknown>,
  factory: DiffOpFactory,
  prefix = ""
): SemanticOp[] {
  const ops: SemanticOp[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(target)]);
  for (const key of Array.from(keys)) {
    if (key === factory.skipKey) continue;
    const b = base[key];
    const t = target[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (t === undefined && b !== undefined) {
      ops.push(factory.remove(path));
    } else if (
      b !== null &&
      typeof b === "object" &&
      !Array.isArray(b) &&
      t !== null &&
      typeof t === "object" &&
      !Array.isArray(t)
    ) {
      ops.push(
        ...diffProps(
          b as Record<string, unknown>,
          t as Record<string, unknown>,
          factory,
          path
        )
      );
    } else if (JSON.stringify(b) !== JSON.stringify(t)) {
      ops.push(factory.set(path, t));
    }
  }
  return ops;
}

const ROOT_DIFF_FACTORY: DiffOpFactory = {
  set: (propPath, value) => ({ op: "setRootProp", propPath, value }),
  remove: (propPath) => ({ op: "removeRootProp", propPath }),
};

function blockDiffFactory(blockId: string): DiffOpFactory {
  return {
    set: (propPath, value) => ({ op: "setProp", blockId, propPath, value }),
    remove: (propPath) => ({ op: "removeProp", blockId, propPath }),
    skipKey: "id",
  };
}

/**
 * Compute semantic ops to transform `canonical` into `edited`.
 * Blocks without `props.id` are skipped for structural/prop ops (use template ids in Puck).
 */
export function computeSemanticOps(canonical: Data, edited: Data): SemanticOp[] {
  const ops: SemanticOp[] = [];

  ops.push(
    ...diffProps(getRootProps(canonical), getRootProps(edited), ROOT_DIFF_FACTORY)
  );

  const canonMap = buildPlacementMap(canonical);
  const editMap = buildPlacementMap(edited);
  const canonIdList = Array.from(canonMap.keys());
  const editIdList = Array.from(editMap.keys());
  const canonIds = new Set(canonIdList);
  const editIds = new Set(editIdList);

  // Classify each canon ID: removed, type-changed (treated as remove+add), or retained.
  const toRemove = new Set<string>();
  const toAdd = new Set<string>();
  for (const id of canonIdList) {
    if (!editIds.has(id)) {
      toRemove.add(id);
    } else if (canonMap.get(id)!.block.type !== editMap.get(id)!.block.type) {
      toRemove.add(id);
      toAdd.add(id);
    }
  }
  for (const id of Array.from(toRemove)) {
    ops.push({ op: "removeBlock", blockId: id });
  }

  // Retained blocks: emit move and prop-diff ops in one pass.
  for (const id of canonIdList) {
    if (toRemove.has(id)) continue;
    const cp = canonMap.get(id)!;
    const ep = editMap.get(id)!;
    if (cp.slot !== ep.slot || cp.afterId !== ep.afterId) {
      ops.push({ op: "moveBlock", blockId: id, slot: ep.slot, afterId: ep.afterId });
    }
    ops.push(
      ...diffProps(
        cp.block.props as Record<string, unknown>,
        ep.block.props as Record<string, unknown>,
        blockDiffFactory(id)
      )
    );
  }

  // New blocks: IDs in edited but not canonical, plus type-changed IDs.
  for (const id of editIdList) {
    if (!canonIds.has(id)) {
      toAdd.add(id);
    }
  }

  // Preserve edited document order for added blocks.
  const seen = new Set<string>();
  for (const p of flattenPlaced(edited)) {
    const id = getBlockId(p.block);
    if (id && toAdd.has(id) && !seen.has(id)) {
      seen.add(id);
      const e = editMap.get(id)!;
      ops.push({
        op: "addBlock",
        block: {
          type: e.block.type,
          props: deepClone(e.block.props) as Record<string, unknown>,
        },
        slot: e.slot,
        afterId: e.afterId,
      });
    }
  }

  return ops;
}
