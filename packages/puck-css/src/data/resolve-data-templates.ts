import type { Data } from "@puckeditor/core";
import jsep from "jsep";
import type { RemoteDatasourceContext } from "./remote-datasources/loader";
import { resolveCrossPageTemplates } from "./cross-reference-resolve";
import { isComponentNode, isUnsafeKey } from "./paths";
import { toText, TEMPLATE_FUNCTIONS } from "./template-functions";

function expandListMarkdownLinks(
  input: string,
  context: RemoteDatasourceContext
): string {
  const re =
    /\{\{\s*([\w-]+)\.markdownLinks(?:\s+(["'])([^"']*)\2)?\s*\}\}/g;
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
      const label = name.replace(/[[\]]/g, "");
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
    if (isUnsafeKey(p)) return undefined;
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
  // Datasource ids are kebab-case — `templates.<ccr-query-name>` and P1's
  // auto-generated content-type ids like `blog-post` — and jsep
  // would read those hyphens as subtraction, so dotted paths have to be
  // recognised here rather than fall through to expression evaluation.
  if (!/^[\w.-]+$/.test(inner) || inner.endsWith(".")) return { resolved: false };
  const segments = inner.split(".");
  let sourceName: string;
  let pathSegments: string[];
  if (segments[0] === "templates" && segments.length >= 2) {
    sourceName = `${segments[0]}.${segments[1]}`;
    pathSegments = segments.slice(2);
  } else {
    sourceName = segments[0] ?? "";
    pathSegments = segments.slice(1);
  }
  const pathWithinSource = pathSegments.join(".");
  const sourceRow = context[sourceName as string];
  if (!sourceRow || typeof sourceRow !== "object" || Array.isArray(sourceRow)) {
    return { resolved: true, value: undefined };
  }
  const value = pathWithinSource
    ? getByPath(sourceRow as Record<string, unknown>, pathWithinSource)
    : sourceRow;
  return { resolved: true, value };
}

function evalTemplateExpression(node: unknown, context: RemoteDatasourceContext): unknown {
  if (!node || typeof node !== "object") {
    return undefined;
  }

  const n = node as Record<string, unknown>;

  if (n.type === "Identifier") {
    return context[n.name as string];
  }

  if (n.type === "Literal") {
    return n.value;
  }

  if (n.type === "MemberExpression") {
    if (!n.computed) {
      const obj = n.object as Record<string, unknown>;
      const prop = n.property as Record<string, unknown>;
      if (obj.type === "Identifier" && obj.name === "templates" && prop.type === "Identifier") {
        const compoundKey = `templates.${prop.name as string}`;
        if (compoundKey in context) {
          return context[compoundKey];
        }
      }
    }
    const base = evalTemplateExpression(n.object, context);
    if (!base || typeof base !== "object") {
      return undefined;
    }
    if (Array.isArray(base) && !n.computed) {
      return undefined;
    }
    let key: string | undefined;
    if (n.computed) {
      const computedKey = evalTemplateExpression(n.property, context);
      if (typeof computedKey === "string" || typeof computedKey === "number") {
        key = String(computedKey);
      }
    } else {
      const prop = n.property as Record<string, unknown>;
      if (prop.type === "Identifier") {
        key = prop.name as string;
      }
    }
    if (!key || isUnsafeKey(key)) return undefined;
    return (base as Record<string, unknown>)[key];
  }

  if (n.type === "CallExpression") {
    const callee = n.callee as Record<string, unknown>;
    if (callee.type !== "Identifier") {
      return undefined;
    }
    const fn = TEMPLATE_FUNCTIONS[callee.name as string];
    if (!fn) {
      return undefined;
    }
    const args: unknown[] = [];
    const argsList = n.arguments as unknown[];
    for (const arg of argsList) {
      const argNode = arg as Record<string, unknown>;
      if (argNode.type === "SpreadElement") {
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
export async function resolveStringTemplates(
  input: string,
  context: RemoteDatasourceContext
): Promise<string> {
  const afterCrossPage = await resolveCrossPageTemplates(input);
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

async function resolveValue(value: unknown, context: RemoteDatasourceContext): Promise<unknown> {
  if (typeof value === "string") {
    // Resolve cross-page references first so that whole-value resolution
    // does not swallow `{{ pages[...] }}` tokens as unknown datasource keys.
    const afterCrossPage = await resolveCrossPageTemplates(value);
    const whole = resolveWholeTemplateValue(afterCrossPage, context);
    if (whole.matched) {
      return whole.value;
    }
    return resolveStringTemplates(afterCrossPage, context);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(async (item) => {
      if (isComponentNode(item)) {
        return {
          ...item,
          props: await resolvePropsObject(item.props, context),
        };
      }
      return resolveValue(item, context);
    }));
  }
  if (value && typeof value === "object") {
    return resolvePlainObject(value as Record<string, unknown>, context);
  }
  return value;
}

/** Regex that matches safe object-property keys (identifiers, hyphenated names, numeric indices). */
const SAFE_PROP_KEY_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$-]*$|^\d+$/;

async function resolvePropsObject(
  props: Record<string, unknown>,
  context: RemoteDatasourceContext
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const entries = Object.keys(props)
    .filter((key) => SAFE_PROP_KEY_REGEX.test(key))
    .map(async (key) => [key, await resolveValue(props[key], context)] as const);
  for (const [key, val] of await Promise.all(entries)) {
    out[key] = val;
  }
  return out;
}

async function resolvePlainObject(
  obj: Record<string, unknown>,
  context: RemoteDatasourceContext
): Promise<Record<string, unknown>> {
  if (isComponentNode(obj)) {
    return {
      ...obj,
      props: await resolvePropsObject(obj.props, context),
    };
  }
  const out: Record<string, unknown> = {};
  const entries = Object.keys(obj)
    .filter((key) => SAFE_PROP_KEY_REGEX.test(key))
    .map(async (key) => [key, await resolveValue(obj[key], context)] as const);
  for (const [key, val] of await Promise.all(entries)) {
    out[key] = val;
  }
  return out;
}

async function resolveRoot(root: unknown, context: RemoteDatasourceContext): Promise<unknown> {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return root;
  }
  return resolvePlainObject(root as Record<string, unknown>, context);
}

/**
 * Deep-walk Puck `Data`: interpolate all string props in `root`, `content`, and `zones`.
 */
export async function resolveDataTemplates<T extends Partial<Data>>(
  data: T,
  context: RemoteDatasourceContext
): Promise<T> {
  const cloned = structuredClone(data) as T;
  const d = cloned as Partial<Data>;

  // Resolve root, content, and zones in parallel
  const [resolvedRoot, resolvedContent, resolvedZones] = await Promise.all([
    d.root !== undefined ? resolveRoot(d.root, context) : undefined,
    d.content !== undefined ? resolveValue(d.content, context) : undefined,
    d.zones !== undefined && d.zones !== null
      ? (async () => {
          const zones = d.zones as Record<string, Data["content"]>;
          const zoneEntries = Object.keys(zones).map(async (key) =>
            [key, await resolveValue(zones[key], context)] as const
          );
          for (const [key, val] of await Promise.all(zoneEntries)) {
            zones[key] = val as Data["content"];
          }
          return zones;
        })()
      : undefined,
  ]);

  if (resolvedRoot !== undefined) {
    d.root = resolvedRoot as Data["root"];
  }
  if (resolvedContent !== undefined) {
    d.content = resolvedContent as Data["content"];
  }
  if (resolvedZones !== undefined) {
    d.zones = resolvedZones;
  }

  return cloned;
}
