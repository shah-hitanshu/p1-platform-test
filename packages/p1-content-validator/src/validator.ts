import type { EditOperation, ValidateInput, ValidationError, ComponentSchema, ComponentField } from './types.js';
import { registryComponentKey } from './registry.js';
import { isComponentShape, resolvePropPath, type ComponentShape } from './guards.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// UUID v4:             xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Puck type-prefixed:  {ComponentType}-{uuid-v4}
const PREFIXED_UUID_RE = /^[A-Za-z][A-Za-z0-9]*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// ULID:                26 Crockford base32 chars (legacy — MCP server previously generated these)
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function isValidPuckId(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  return UUID_V4_RE.test(value) || PREFIXED_UUID_RE.test(value) || ULID_RE.test(value);
}

function allowedPropsForSchema(schema: ComponentSchema): Set<string> {
  return new Set<string>([
    'id',
    ...Object.keys(schema.defaultProps),
    ...(schema.fields?.map((f) => f.name) ?? []),
    ...(schema.allowedAdditionalProps ?? []),
  ]);
}

/** Returns the field definition for a prop key, or undefined if not found. */
function findField(schema: ComponentSchema, propKey: string): ComponentField | undefined {
  return schema.fields?.find((f) => f.name === propKey);
}

/**
 * Validates a prop value against a select/radio field's allowed options.
 * Only fires when the field has options defined and the value is a string.
 */
function validateEnumValue(
  field: ComponentField,
  value: unknown,
  componentType: string,
  propKey: string,
  opIndex: number,
  path: string,
  errors: ValidationError[],
): void {
  if (
    (field.type !== 'select' && field.type !== 'radio') ||
    field.options === undefined ||
    field.options.length === 0
  ) {
    return;
  }
  // Only validate primitives — skip array/object values (e.g. stats array items)
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return;
  const allowedValues = field.options.map((o) => o.value);
  if (!allowedValues.includes(value)) {
    errors.push({
      opIndex,
      path,
      code: 'invalid_prop_value',
      message:
        `Invalid value ${JSON.stringify(value)} for ${field.type} prop "${propKey}" on "${componentType}". ` +
        `Allowed values: ${allowedValues.map((v) => JSON.stringify(v)).join(', ')}.`,
    });
  }
}

function validateComponent(
  comp: ComponentShape,
  registry: Record<string, ComponentSchema>,
  opIndex: number,
  path: string,
  errors: ValidationError[],
  zonesKey: string,
  warnOnZonesUsage: boolean,
): void {
  // readOnly is a Puck runtime-managed sibling — writers must not set it
  if ('readOnly' in comp) {
    errors.push({
      opIndex,
      path: `${path}.readOnly`,
      code: 'invalid_readonly_key',
      message: `"readOnly" at "${path}" is a Puck runtime field and must not be set by writers.`,
    });
  }

  // Every Puck component must have a valid id in its props — it is how the
  // editor tracks the component instance. Accept UUID v4, type-prefixed UUID v4,
  // or ULID; reject arbitrary strings like "roger".
  if (!('id' in comp.props)) {
    errors.push({
      opIndex,
      path: `${path}.props`,
      code: 'missing_required_prop',
      message: `Component "${comp.type}" at "${path}" is missing required prop "id". Every Puck component must have an id (UUID v4, {Type}-{uuid-v4}, or ULID).`,
    });
  } else if (!isValidPuckId(comp.props.id)) {
    errors.push({
      opIndex,
      path: `${path}.props.id`,
      code: 'invalid_prop_value',
      message: `Invalid id "${String(comp.props.id)}" on "${comp.type}" at "${path}". Must be UUID v4, type-prefixed UUID v4 (e.g. Hero-{uuid}), or ULID.`,
    });
  }

  const schema = registry[registryComponentKey(comp.type)];
  if (!schema) {
    errors.push({
      opIndex,
      path,
      code: 'unknown_component_type',
      message:
        `Unknown component type "${comp.type}" at "${path}". ` +
        `Use list_components to see available types: ${Object.entries(registry).map(([key, s]) => s.name ?? key).join(', ')}.`,
    });
    return;
  }

  // The descriptor's own `name` is the source of truth for a component type's
  // casing. The lookup above is case-insensitive on purpose, and must stay that
  // way: it is how a mis-cased type gets *found* so the error below can name the
  // casing the writer should have used. Making it exact would degrade this into
  // a bare unknown_component_type and lose the actionable hint.
  //
  // Matching loosely is not licence to write loosely. Puck resolves `type` by
  // exact key lookup into config.components with no normalisation and no guard
  // (verified in @puckeditor/core@0.21.1 — chunk-EBISZQTK.mjs:4124 reads
  // `config.components[item.type]` then dereferences `.fields` unguarded, so a
  // miss throws), which means a document holding "quoteblock" against a config
  // keyed "QuoteBlock" breaks the editor and the published page even though
  // every prop on it validated fine.
  //
  // Reject rather than silently canonicalise: a writer that meant a different
  // component should hear about it, and naming the expected casing makes the fix
  // mechanical.
  //
  // `schema.name` is required for in-repo callers but validateOps is a public
  // boundary — a hand-built registry may omit it, and there is no canonical
  // casing to hold the writer to in that case.
  if (typeof schema.name === 'string' && schema.name !== '' && comp.type !== schema.name) {
    errors.push({
      opIndex,
      path,
      code: 'component_type_case_mismatch',
      message:
        `Component type "${comp.type}" at "${path}" does not match the registered ` +
        `casing "${schema.name}". Component types are case-sensitive — use "${schema.name}".`,
    });
    return;
  }

  const allowedKeys = allowedPropsForSchema(schema);

  for (const [key, value] of Object.entries(comp.props)) {
    if (!allowedKeys.has(key)) {
      errors.push({
        opIndex,
        path: `${path}.props.${key}`,
        code: 'invalid_prop_key',
        message:
          `Unknown prop "${key}" on "${comp.type}" at "${path}.props". ` +
          `Allowed: ${[...allowedKeys].join(', ')}.`,
      });
      continue; // no point checking value if key is invalid
    }

    // Validate enum values for select/radio fields
    const field = findField(schema, key);
    if (field !== undefined) {
      validateEnumValue(field, value, comp.type, key, opIndex, `${path}.props.${key}`, errors);
    }
  }

  // Recurse into slot props: non-opaque array props containing component shapes
  const opaqueProps = new Set<string>(schema.opaqueProps ?? []);
  for (const [key, val] of Object.entries(comp.props)) {
    if (opaqueProps.has(key) || key === 'id') continue;
    if (Array.isArray(val) && val.some(isComponentShape)) {
      validateContent(val, registry, opIndex, `${path}.props.${key}`, errors, zonesKey, warnOnZonesUsage);
    }
  }
}

function validateContent(
  value: unknown,
  registry: Record<string, ComponentSchema>,
  opIndex: number,
  path: string,
  errors: ValidationError[],
  zonesKey: string,
  warnOnZonesUsage: boolean,
): void {
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      validateContent(item, registry, opIndex, `${path}.${i}`, errors, zonesKey, warnOnZonesUsage);
    });
    return;
  }

  if (isComponentShape(value)) {
    validateComponent(value, registry, opIndex, path, errors, zonesKey, warnOnZonesUsage);
    return;
  }

  // Plain object (e.g., whole-document or sub-document): walk its keys
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path !== '' ? `${path}.${key}` : key;
    if (warnOnZonesUsage && key === zonesKey) {
      errors.push({
        opIndex,
        path: childPath,
        code: 'deprecated_zones_usage',
        message: `"${zonesKey}" is deprecated. Use slot props instead.`,
      });
    }
    validateContent(val, registry, opIndex, childPath, errors, zonesKey, warnOnZonesUsage);
  }
}

/**
 * Validates a targeted prop write (e.g. content.2.props.background = "roger")
 * using the current document snapshot to resolve the component type at the
 * parent path. Checks both the prop key and the value against the registry schema.
 *
 * Only fires when the op path contains ".props." and a snapshot is available.
 */
function validatePropPathOp(
  op: EditOperation,
  opIndex: number,
  snapshot: Record<string, unknown>,
  registry: Record<string, ComponentSchema>,
  errors: ValidationError[],
): void {
  const resolved = resolvePropPath(op.path, snapshot);
  if (resolved === undefined) return;
  const { component: val, componentPath, propsIdx, parts } = resolved;

  const schema = registry[registryComponentKey(val.type)];
  if (!schema) return; // unknown type — caught elsewhere when the component is replaced

  // Deliberately no case-mismatch check here: `val.type` is read from the
  // stored snapshot, not from this op. A mis-cased type in the document is
  // damage some earlier write already did, and erroring on it would make the
  // document unrepairable — the prop edits that fix it would themselves be
  // rejected. Casing is enforced where a type actually enters the document
  // (validateComponent).

  // Case A: path ends exactly at .props — content is the full props object
  // e.g. replace content.0.props { id, label, visible }
  if (propsIdx === parts.length - 1) {
    if (op.content === null || typeof op.content !== 'object' || Array.isArray(op.content)) return;
    const propsObj = op.content as Record<string, unknown>;
    const allowedKeys = allowedPropsForSchema(schema);

    if (!('id' in propsObj)) {
      errors.push({
        opIndex,
        path: op.path,
        code: 'missing_required_prop',
        message: `Component "${val.type}" at "${componentPath}" is missing required prop "id".`,
      });
    } else if (!isValidPuckId(propsObj.id)) {
      errors.push({
        opIndex,
        path: `${op.path}.id`,
        code: 'invalid_prop_value',
        message: `Invalid id "${String(propsObj.id)}" at "${op.path}.id". Must be UUID v4, type-prefixed UUID v4, or ULID.`,
      });
    }

    for (const [key, value] of Object.entries(propsObj)) {
      if (key === 'id') continue;
      if (!allowedKeys.has(key)) {
        errors.push({
          opIndex,
          path: `${op.path}.${key}`,
          code: 'invalid_prop_key',
          message:
            `Unknown prop "${key}" on "${val.type}" at "${op.path}". ` +
            `Allowed: ${[...allowedKeys].join(', ')}.`,
        });
      } else {
        const field = findField(schema, key);
        if (field !== undefined) {
          validateEnumValue(field, value, val.type, key, opIndex, `${op.path}.${key}`, errors);
        }
      }
    }
    return;
  }

  // Case B: path goes through .props.KEY — targeted single-prop write
  // e.g. replace content.0.props.background "roger"
  const propKey = parts[propsIdx + 1];

  // id is always an allowed key but validate its value format
  if (propKey === 'id') {
    if (!isValidPuckId(op.content)) {
      errors.push({
        opIndex,
        path: op.path,
        code: 'invalid_prop_value',
        message: `Invalid id value "${String(op.content)}" at "${op.path}". Must be UUID v4, type-prefixed UUID v4, or ULID.`,
      });
    }
    return;
  }

  const allowedKeys = allowedPropsForSchema(schema);
  if (!allowedKeys.has(propKey)) {
    errors.push({
      opIndex,
      path: op.path,
      code: 'invalid_prop_key',
      message:
        `Unknown prop "${propKey}" on "${val.type}" at "${componentPath}.props". ` +
        `Allowed: ${[...allowedKeys].join(', ')}.`,
    });
    return;
  }

  const field = findField(schema, propKey);
  if (field !== undefined) {
    validateEnumValue(field, op.content, val.type, propKey, opIndex, op.path, errors);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateOps(input: ValidateInput): { errors: ValidationError[] } {
  const { operations, registry, currentSnapshot, config = {} } = input;

  // Graceful degradation: if registry is empty skip all validation.
  if (Object.keys(registry).length === 0) {
    return { errors: [] };
  }

  // Defense-in-depth: re-key the registry by its case-insensitive lookup key,
  // regardless of what casing the caller's keys already use. Registry
  // producers (fetchRegistry / McpApiClient.fetchRegistrySchemas) already key
  // by registryComponentKey, but validateOps normalizes independently so a
  // caller-supplied registry (e.g. a hand-built one, or one that changes its
  // convention later) can't silently reintroduce case-sensitive misses.
  const normalizedRegistry: Record<string, ComponentSchema> = {};
  for (const [key, schema] of Object.entries(registry)) {
    normalizedRegistry[registryComponentKey(key)] = schema;
  }

  const zonesKey = config.zonesKey ?? 'zones';
  const warnOnZonesUsage = config.warnOnZonesUsage ?? true;
  const errors: ValidationError[] = [];

  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    const op = operations[opIndex];

    if (op.type !== 'add' && op.type !== 'replace') continue;
    if (op.content === undefined) continue;

    if (op.path.split('.').includes('readOnly')) {
      errors.push({
        opIndex,
        path: op.path,
        code: 'invalid_readonly_key',
        message: `Path "${op.path}" targets "readOnly" which is a Puck runtime field and must not be written to.`,
      });
      continue;
    }

    if (warnOnZonesUsage && (op.path === zonesKey || op.path.startsWith(`${zonesKey}.`))) {
      errors.push({
        opIndex,
        path: op.path,
        code: 'deprecated_zones_usage',
        message: `"${zonesKey}" is deprecated. Use slot props instead.`,
      });
    }

    // Snapshot-based validation: catches targeted prop writes where the content
    // is a primitive and the component type must be resolved from the live document.
    if (currentSnapshot !== undefined) {
      validatePropPathOp(op, opIndex, currentSnapshot, normalizedRegistry, errors);
    }

    // Content-shape validation: catches component replacements and slot content.
    validateContent(op.content, normalizedRegistry, opIndex, op.path, errors, zonesKey, warnOnZonesUsage);
  }

  return { errors };
}
