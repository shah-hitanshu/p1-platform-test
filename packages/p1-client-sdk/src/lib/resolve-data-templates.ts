import type { Data } from "@puckeditor/core";
import jsep from "jsep";
import type { RemoteDatasourceContext } from "./remote-datasources/loader";
import { resolveCrossPageTemplates } from "./cross-reference-resolve";
import { isComponentNode } from "./paths";
import { toText, TEMPLATE_FUNCTIONS } from "./template-functions";

function expandListMarkdownLinks(
  input: string,
  context: RemoteDatasourceContext
): string {
  const re =
    /\{\{\s*([\w]+)\.markdownLinks(?:\s+(["'])([^"']*)\2)?\s*\}\}/g;
  return input.replace(re, (_m, sourceName: string, _quote, hrefTemplateRaw: string | undefined) => {
    const raw = context[sourceName];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return "";
    }
    const items = (raw as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      return "";
    }
    const hrefTemplate = (hrefTemplateRaw || "/{id}").trim();
    if (!hrefTemplate) {
      return "";
    }
    const lines: string[] = [];
    for (const it of items) {
      if (!it || typeof it !== "object" || Array.isArray(it)) {
        continue;
      }
      const row = it as Record<string, unknown>;
      const id = String(row.id ?? "");
      const name = String(row.name ?? "");
      if (!id || !name) {
        continue;
      }
      const href = hrefTemplate
        .replace(/\{id\}/g, id)
        .replace(/\{name\}/g, encodeURIComponent(name));
      const label = name.replace(/[\[\]]/g, "");
      lines.push(`[${label}](${href})`);
    }
    return lines.join("\n");
  });
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".");
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
 * Resolve a simple `source.path.to.value` expression from the datasource context.
 * Returns `{ resolved: true, value }` if the inner string is a dotted identifier path,
 * or `{ resolved: false }` if it requires full expression evaluation.
 */
function resolveSourcePath(
  inner: string,
  context: RemoteDatasourceContext
): { resolved: true; value: unknown } | { resolved: false } {
  if (!/^[\w.]+$/.test(inner)) return { resolved: false };
  const segments = inner.split(".");
  const sourceName = segments[0];
  const pathWithinSource = segments.slice(1).join(".");
  const sourceRow = context[sourceName];
  if (!sourceRow || typeof sourceRow !== "object" || Array.isArray(sourceRow)) {
    return { resolved: true, value: undefined };
  }
  const value = pathWithinSource
    ? getByPath(sourceRow as Record<string, unknown>, pathWithinSource)
    : sourceRow;
  return { resolved: true, value };
}

function evalTemplateExpression(node: any, context: RemoteDatasourceContext): unknown {
  if (node.type === "Identifier") {
    return context[node.name];
  }

  if (node.type === "Literal") {
    return node.value;
  }

  if (node.type === "MemberExpression") {
    const base = evalTemplateExpression(node.object, context);
    if (!base || typeof base !== "object" || Array.isArray(base)) {
      return undefined;
    }
    let key: string | undefined;
    if (node.computed) {
      const computedKey = evalTemplateExpression(node.property, context);
      if (typeof computedKey === "string" || typeof computedKey === "number") {
        key = String(computedKey);
      }
    } else if (node.property.type === "Identifier") {
      key = node.property.name;
    }
    if (!key) return undefined;
    return (base as Record<string, unknown>)[key];
  }

  if (node.type === "CallExpression") {
    if (node.callee.type !== "Identifier") {
      return undefined;
    }
    const fn = TEMPLATE_FUNCTIONS[node.callee.name];
    if (!fn) {
      return undefined;
    }
    const args: unknown[] = [];
    for (const arg of node.arguments) {
      if (arg.type === "SpreadElement") {
        return undefined;
      }
      args.push(evalTemplateExpression(arg, context));
    }
    return fn(args);
  }

  return undefined;
}

function resolveTemplateExpression(inner: string, context: RemoteDatasourceContext): string {
  const value = resolveTemplateExpressionValue(inner, context);
  return toText(value);
}

function resolveTemplateExpressionValue(
  inner: string,
  context: RemoteDatasourceContext
): unknown {
  try {
    const parsed = jsep(inner);
    return evalTemplateExpression(parsed, context);
  } catch {
    return undefined;
  }
}

function resolveWholeTemplateValue(
  input: string,
  context: RemoteDatasourceContext
): { matched: boolean; value: unknown } {
  const exact = input.match(/^\s*\{\{([^{}]+)\}\}\s*$/);
  if (!exact) return { matched: false, value: undefined };
  const inner = String(exact[1]).trim();
  if (!inner) return { matched: true, value: "" };
  // Preserve block-local item templates (e.g. `{{ item.name }}`) for component-level rendering.
  if (inner === "item" || inner.startsWith("item.")) {
    return { matched: false, value: undefined };
  }

  const result = resolveSourcePath(inner, context);
  const value = result.resolved
    ? result.value
    : resolveTemplateExpressionValue(inner, context);

  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { matched: true, value: toText(value) };
  }
  if (Array.isArray(value) || typeof value === "object") {
    return { matched: true, value: structuredClone(value) };
  }
  return { matched: true, value: "" };
}

/**
 * Replace `{{ source.key }}` / `{{ source.nested.key }}` using datasource context.
 * Unknown sources or missing values become empty strings.
 */
export function resolveStringTemplates(
  input: string,
  context: RemoteDatasourceContext
): string {
  const afterCrossPage = resolveCrossPageTemplates(input);
  const afterList = expandListMarkdownLinks(afterCrossPage, context);
  // Fresh RegExp each call — avoid `/g` lastIndex issues across invocations.
  return afterList.replace(/\{\{([^{}]+)\}\}/g, (_match, rawExpression: string) => {
    const inner = String(rawExpression).trim();
    if (!inner) return "";
    // Keep `item` tokens intact so blocks can resolve per-item templates at render time.
    if (inner === "item" || inner.startsWith("item.")) {
      return _match;
    }

    // Fast path for common `source.path` expressions.
    const result = resolveSourcePath(inner, context);
    if (result.resolved) {
      return toText(result.value);
    }

    return resolveTemplateExpression(inner, context);
  });
}

function resolveValue(value: unknown, context: RemoteDatasourceContext): unknown {
  if (typeof value === "string") {
    // Resolve cross-page references first so that whole-value resolution
    // does not swallow `{{ pages[...] }}` tokens as unknown datasource keys.
    const afterCrossPage = resolveCrossPageTemplates(value);
    const whole = resolveWholeTemplateValue(afterCrossPage, context);
    if (whole.matched) {
      return whole.value;
    }
    return resolveStringTemplates(afterCrossPage, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (isComponentNode(item)) {
        return {
          ...item,
          props: resolvePropsObject(item.props, context),
        };
      }
      return resolveValue(item, context);
    });
  }
  if (value && typeof value === "object") {
    return resolvePlainObject(value as Record<string, unknown>, context);
  }
  return value;
}

/** Regex that matches safe object-property keys (identifiers, hyphenated names, numeric indices). */
const SAFE_PROP_KEY_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$\-]*$|^\d+$/;

function resolvePropsObject(
  props: Record<string, unknown>,
  context: RemoteDatasourceContext
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (!SAFE_PROP_KEY_REGEX.test(key)) continue;
    out[key] = resolveValue(props[key], context);
  }
  return out;
}

function resolvePlainObject(
  obj: Record<string, unknown>,
  context: RemoteDatasourceContext
): Record<string, unknown> {
  if (isComponentNode(obj)) {
    return {
      ...obj,
      props: resolvePropsObject(obj.props, context),
    };
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!SAFE_PROP_KEY_REGEX.test(key)) continue;
    out[key] = resolveValue(obj[key], context);
  }
  return out;
}

function resolveRoot(root: unknown, context: RemoteDatasourceContext): unknown {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return root;
  }
  return resolvePlainObject(root as Record<string, unknown>, context);
}

/**
 * Deep-walk Puck `Data`: interpolate all string props in `root`, `content`, and `zones`.
 */
export function resolveDataTemplates<T extends Partial<Data>>(
  data: T,
  context: RemoteDatasourceContext
): T {
  const cloned = structuredClone(data) as T;
  const d = cloned as Partial<Data>;

  if (d.root !== undefined) {
    d.root = resolveRoot(d.root, context) as Data["root"];
  }
  if (d.content !== undefined) {
    d.content = resolveValue(d.content, context) as Data["content"];
  }
  if (d.zones !== undefined && d.zones !== null) {
    const zones: Record<string, Data["content"]> = {};
    for (const key of Object.keys(d.zones)) {
      zones[key] = resolveValue(d.zones[key], context) as Data["content"];
    }
    d.zones = zones;
  }

  return cloned;
}
