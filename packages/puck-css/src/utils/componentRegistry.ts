/**
 * Component Registry Utilities
 *
 * Utilities for serialising Puck component configs into machine-readable
 * ComponentDescriptor objects, hashing them for change detection, and
 * building the RegistryIndex stored at /_registry/index.
 */

// =============================================================================
// Types
// =============================================================================

export type ComponentProvenance = 'site' | 'upstream' | 'overridden';

export interface FieldAiMeta {
  instructions?: string;
  required?: boolean;
  schema?: unknown;
  exclude?: boolean;
  /** Set to false to disable streaming for this field (e.g., image URLs, hrefs — streaming partial URLs causes broken values) */
  stream?: boolean;
  /** Connects this field to the output of an inline AI tool (Puck AI plugin feature) */
  bind?: string;
}

export type SerializedField =
  | { type: 'text'; name: string; label?: string; ai?: FieldAiMeta }
  | { type: 'textarea'; name: string; label?: string; ai?: FieldAiMeta }
  | { type: 'number'; name: string; label?: string; min?: number; max?: number; ai?: FieldAiMeta }
  | { type: 'select'; name: string; label?: string; options: Array<{ label: string; value: string | number | boolean }>; ai?: FieldAiMeta }
  | { type: 'radio'; name: string; label?: string; options: Array<{ label: string; value: string | number | boolean }>; ai?: FieldAiMeta }
  | { type: 'array'; name: string; label?: string; arrayFields: SerializedField[]; ai?: FieldAiMeta }
  | { type: 'object'; name: string; label?: string; objectFields: SerializedField[]; ai?: FieldAiMeta }
  | { type: 'custom'; name: string; label?: string; ai?: FieldAiMeta };

export interface ComponentDescriptor {
  name: string;
  label: string;
  fields: SerializedField[];
  defaultProps: Record<string, unknown>;
  ai?: { instructions?: string; defaultZone?: string; exclude?: boolean };
  slots?: Record<string, { allowedComponents?: string[]; minItems?: number; maxItems?: number }>;
  provenance: ComponentProvenance;
  descriptorHash: string;
  upstreamHash?: string;
  registeredAt: string;
}

export interface RegistryIndex {
  siteId: string;
  branchId: string;
  updatedAt: string;
  componentNames: string[];
  provenance: Record<string, ComponentProvenance>;
  /**
   * Map of componentName → descriptorHash for fast change detection on startup.
   * When present, the registry hook reads all hashes from this single index version
   * instead of fetching each component document individually (N requests → 1).
   */
  hashes?: Record<string, string>;
}

// =============================================================================
// Field serialization
// =============================================================================

/**
 * Converts a Puck field definition to a JSON-serializable SerializedField.
 * Strips non-serializable properties (render functions, getItemSummary, etc.).
 * Recursively handles array.arrayFields and object.objectFields.
 */
export function serializeField(field: Record<string, unknown>, name: string): SerializedField {
  const ai = field.ai as FieldAiMeta | undefined;

  switch (field.type) {
    case 'text':
    case 'textarea':
      return {
        type: field.type as 'text' | 'textarea',
        name,
        ...(field.label !== undefined && { label: field.label as string }),
        ...(ai !== undefined && { ai }),
      };
    case 'number': {
      const result: { type: 'number'; name: string; label?: string; min?: number; max?: number; ai?: FieldAiMeta } = { type: 'number', name };
      if (field.label !== undefined) result.label = field.label as string;
      if (field.min !== undefined) result.min = field.min as number;
      if (field.max !== undefined) result.max = field.max as number;
      if (ai !== undefined) result.ai = ai;
      return result;
    }
    case 'select':
    case 'radio': {
      const options = (field.options as Array<{ label: string; value: string | number | boolean }>) ?? [];
      return {
        type: field.type as 'select' | 'radio',
        name,
        ...(field.label !== undefined && { label: field.label as string }),
        options,
        ...(ai !== undefined && { ai }),
      };
    }
    case 'array': {
      const rawArrayFields = (field.arrayFields ?? {}) as Record<string, Record<string, unknown>>;
      const arrayFields = Object.entries(rawArrayFields).map(([k, v]) => serializeField(v, k));
      return {
        type: 'array',
        name,
        ...(field.label !== undefined && { label: field.label as string }),
        arrayFields,
        ...(ai !== undefined && { ai }),
      };
    }
    case 'object': {
      const rawObjectFields = (field.objectFields ?? {}) as Record<string, Record<string, unknown>>;
      const objectFields = Object.entries(rawObjectFields).map(([k, v]) => serializeField(v, k));
      return {
        type: 'object',
        name,
        ...(field.label !== undefined && { label: field.label as string }),
        objectFields,
        ...(ai !== undefined && { ai }),
      };
    }
    default:
      // Treat all unrecognised types (including custom with render functions) as 'custom'
      return {
        type: 'custom',
        name,
        ...(field.label !== undefined && { label: field.label as string }),
        ...(ai !== undefined && { ai }),
      };
  }
}

// =============================================================================
// Hash computation
// =============================================================================

/**
 * Sorts object keys recursively to produce a canonical JSON representation.
 * This ensures hash stability regardless of key insertion order.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/**
 * djb2 hash over the canonical JSON of a descriptor.
 *
 * The following fields are intentionally excluded from the hash input:
 * - `descriptorHash`: the hash itself must not feed into its own computation.
 * - `registeredAt`: a timestamp that changes on every registration run; including
 *   it would make every component appear "changed" on every editor open.
 * - `provenance`: a classification artifact derived from comparing site vs upstream
 *   schemas; it does not describe the component's own shape and should not affect
 *   whether a write is triggered.
 * - `upstreamHash`: similarly a comparative artifact, not part of the schema identity.
 *
 * This is an intentional improvement over the plan (which only called out
 * `descriptorHash` and `registeredAt`). Excluding `provenance` and `upstreamHash`
 * prevents spurious re-writes when the upstream config changes but the site
 * component schema is unchanged.
 */
export function hashDescriptor(
  descriptor: Omit<ComponentDescriptor, 'descriptorHash'> & { descriptorHash?: string },
): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { descriptorHash: _ignored, registeredAt: _ts, provenance: _prov, upstreamHash: _up, ...hashable } = descriptor;
  const json = JSON.stringify(sortKeys(hashable));
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = ((hash << 5) + hash) ^ json.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16);
}

// =============================================================================
// Descriptor extraction
// =============================================================================

/** Builds a descriptor without provenance/hash/timestamp fields (used for hashing) */
function buildPartialDescriptor(
  name: string,
  compConfig: Record<string, unknown>,
): Omit<ComponentDescriptor, 'provenance' | 'descriptorHash' | 'registeredAt' | 'upstreamHash'> {
  const rawFields = (compConfig.fields ?? {}) as Record<string, Record<string, unknown>>;
  const fields = Object.entries(rawFields).map(([k, v]) => serializeField(v, k));

  const result: Omit<ComponentDescriptor, 'provenance' | 'descriptorHash' | 'registeredAt' | 'upstreamHash'> = {
    name,
    label: (compConfig.label as string | undefined) ?? name,
    fields,
    defaultProps: (compConfig.defaultProps as Record<string, unknown>) ?? {},
  };

  // AI metadata (from @puckeditor/plugin-ai convention)
  const ai = compConfig.ai as ComponentDescriptor['ai'] | undefined;
  if (ai !== undefined) result.ai = ai;

  // Slot constraints
  const slots = compConfig.slots as ComponentDescriptor['slots'] | undefined;
  if (slots !== undefined) result.slots = slots;

  return result;
}

/**
 * Extracts ComponentDescriptors from a Puck config object.
 * Optionally classifies provenance against an upstream Puck config.
 *
 * @param puckConfig - The site's Puck config (as passed to <Puck config={...} />)
 * @param upstreamConfig - Optional Custom Upstream's Puck config for provenance comparison
 */
export function extractDescriptors(
  puckConfig: unknown,
  upstreamConfig?: unknown,
): ComponentDescriptor[] {
  const config = puckConfig as Record<string, unknown>;
  const components = (config.components ?? {}) as Record<string, Record<string, unknown>>;

  // Pre-compute upstream descriptors for O(1) hash lookup
  let upstreamDescriptors: Map<string, ComponentDescriptor> | null = null;
  if (upstreamConfig !== undefined) {
    const upstream = upstreamConfig as Record<string, unknown>;
    const upstreamComponents = (upstream.components ?? {}) as Record<string, Record<string, unknown>>;
    upstreamDescriptors = new Map();
    for (const [name, compConfig] of Object.entries(upstreamComponents)) {
      const partial = buildPartialDescriptor(name, compConfig);
      upstreamDescriptors.set(name, {
        ...partial,
        provenance: 'site',
        descriptorHash: '',
        registeredAt: '',
      });
    }
    // Also index upstream root if present
    const upstreamRoot = (upstream.root ?? null) as Record<string, unknown> | null;
    if (upstreamRoot !== null) {
      const partial = buildPartialDescriptor('__root__', { ...upstreamRoot, label: 'Page Root' });
      upstreamDescriptors.set('__root__', {
        ...partial,
        provenance: 'site',
        descriptorHash: '',
        registeredAt: '',
      });
    }
  }

  const now = new Date().toISOString();
  const results: ComponentDescriptor[] = [];

  // Build a combined map: root (as __root__) + named components
  const allComponents = new Map<string, Record<string, unknown>>();
  const rootConfig = (config.root ?? null) as Record<string, unknown> | null;
  if (rootConfig !== null) {
    allComponents.set('__root__', { ...rootConfig, label: 'Page Root' });
  }
  for (const [name, compConfig] of Object.entries(components)) {
    allComponents.set(name, compConfig);
  }

  for (const [name, compConfig] of allComponents.entries()) {
    const partial = buildPartialDescriptor(name, compConfig);
    // Hash is computed from schema identity only (name, label, fields, defaultProps, ai, slots).
    // `provenance` and `registeredAt` are passed here only to satisfy the TypeScript type signature
    // of hashDescriptor; they are immediately stripped inside hashDescriptor before hashing begins.
    // The same applies to `upstreamHash` and `descriptorHash` (when present).
    const siteHash = hashDescriptor({ ...partial, provenance: 'site', registeredAt: now });

    let provenance: ComponentProvenance = 'site';
    let upstreamHash: string | undefined;

    if (upstreamDescriptors !== null) {
      const upstreamPartial = upstreamDescriptors.get(name);
      if (upstreamPartial !== undefined) {
        upstreamHash = hashDescriptor({ ...upstreamPartial, provenance: 'upstream', registeredAt: now });
        provenance = siteHash === upstreamHash ? 'upstream' : 'overridden';
      }
    }

    results.push({
      ...partial,
      provenance,
      descriptorHash: siteHash,
      ...(upstreamHash !== undefined && { upstreamHash }),
      registeredAt: now,
    });
  }

  return results;
}

// =============================================================================
// Registry index
// =============================================================================

/** Builds the RegistryIndex from a list of extracted descriptors. */
export function buildRegistryIndex(
  descriptors: ComponentDescriptor[],
  siteId: string,
  branchId: string,
): RegistryIndex {
  return {
    siteId,
    branchId,
    updatedAt: new Date().toISOString(),
    componentNames: descriptors.map((d) => d.name),
    provenance: Object.fromEntries(descriptors.map((d) => [d.name, d.provenance])),
    hashes: Object.fromEntries(descriptors.map((d) => [d.name, d.descriptorHash])),
  };
}
