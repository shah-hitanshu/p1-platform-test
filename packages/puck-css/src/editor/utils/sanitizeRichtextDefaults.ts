/**
 * Strip empty-string defaults from richtext fields in a Puck config.
 *
 * Puck merges `defaultProps` underneath stored props on every render, so a
 * block whose stored props omit a richtext key silently renders that key's
 * default. An empty-string default is fatal there: Puck's RichTextRender wraps
 * any non-HTML string as `{type:"text", text: value}`, and prosemirror-model
 * rejects a zero-length text node with `RangeError: Empty text nodes are not
 * allowed` — taking down the whole subtree, since that render path has no error
 * boundary. `undefined` is safe (it normalizes to an empty doc), so dropping
 * the key is strictly better than defaulting to "".
 *
 * Runs over nested object/array fields too, since richtext commonly lives
 * inside array items.
 */

type FieldLike = {
  type?: string;
  objectFields?: Record<string, FieldLike>;
  arrayFields?: Record<string, FieldLike>;
};

type Props = Record<string, unknown>;

type ComponentLike = {
  fields?: Record<string, FieldLike>;
  defaultProps?: Props;
};

type ConfigLike = {
  components?: Record<string, ComponentLike>;
  root?: ComponentLike;
};

const DROP = Symbol('drop');

function sanitizeValue(field: FieldLike | undefined, value: unknown): unknown | typeof DROP {
  if (!field) return value;

  if (field.type === 'richtext') {
    return value === '' ? DROP : value;
  }

  if (field.type === 'object' && field.objectFields && isPlainObject(value)) {
    return sanitizeProps(field.objectFields, value);
  }

  if (field.type === 'array' && field.arrayFields && Array.isArray(value)) {
    const itemFields = field.arrayFields;
    // `map` always allocates, so compare item identity to decide whether the
    // array actually changed — otherwise the caller sees a new reference and
    // treats an untouched config as modified.
    let itemChanged = false;
    const next = value.map((item) => {
      if (!isPlainObject(item)) return item;
      const sanitized = sanitizeProps(itemFields, item);
      if (sanitized !== item) itemChanged = true;
      return sanitized;
    });
    return itemChanged ? next : value;
  }

  return value;
}

function sanitizeProps(fields: Record<string, FieldLike>, props: Props): Props {
  let changed = false;
  const next: Props = {};

  for (const [key, value] of Object.entries(props)) {
    const sanitized = sanitizeValue(fields[key], value);
    if (sanitized === DROP) {
      changed = true;
      continue;
    }
    if (sanitized !== value) changed = true;
    next[key] = sanitized;
  }

  return changed ? next : props;
}

function isPlainObject(value: unknown): value is Props {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeComponent(component: ComponentLike): ComponentLike {
  const { fields, defaultProps } = component;
  if (!fields || !defaultProps) return component;

  const next = sanitizeProps(fields, defaultProps);
  return next === defaultProps ? component : { ...component, defaultProps: next };
}

/**
 * Return a config with empty-string richtext defaults removed. Returns the
 * input unchanged (same reference) when there is nothing to strip, so it is
 * safe to call in a render path without breaking Puck's memoization.
 */
// Generic in T rather than constrained to ConfigLike: Puck's `Config` field
// unions don't structurally satisfy the loose shape this walks, and callers
// should get their own config type back untouched.
export function sanitizeRichtextDefaults<T>(config: T): T {
  const input = config as ConfigLike;
  let changed = false;
  const nextComponents: Record<string, ComponentLike> = {};

  for (const [name, component] of Object.entries(input.components ?? {})) {
    const next = sanitizeComponent(component);
    if (next !== component) changed = true;
    nextComponents[name] = next;
  }

  const nextRoot = input.root ? sanitizeComponent(input.root) : input.root;
  if (nextRoot !== input.root) changed = true;

  if (!changed) return config;

  return {
    ...input,
    ...(input.components ? { components: nextComponents } : {}),
    ...(nextRoot ? { root: nextRoot } : {}),
  } as T;
}
