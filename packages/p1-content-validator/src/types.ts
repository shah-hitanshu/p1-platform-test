export interface EditOperation {
  type: 'add' | 'remove' | 'replace' | 'move' | 'reorder';
  path: string;
  content?: unknown;
  index?: number;
  fromIndex?: number;
  toIndex?: number;
}

export interface FieldOption {
  label: string;
  value: string | number | boolean;
}

/**
 * Whether a translation prop's value is owned by the canonical it derives from
 * (`canonical` — inherited/propagated down) or by the translation itself
 * (`locale` — sovereign). A property of the relationship, not of the field.
 */
export type Authority = 'canonical' | 'locale';

export interface ComponentField {
  name: string;
  type: string;
  options?: FieldOption[];
}

export interface ComponentSchema {
  name: string;
  defaultProps: Record<string, unknown>;
  allowedAdditionalProps?: string[];
  opaqueProps?: string[];
  /** Field definitions from the registry, used for enum value validation. */
  fields?: ComponentField[];
}

export interface ValidationError {
  opIndex: number;
  path: string;
  code:
    | 'unknown_component_type'
    | 'component_type_case_mismatch'
    | 'invalid_prop_key'
    | 'invalid_prop_value'
    | 'missing_required_prop'
    | 'invalid_readonly_key'
    | 'deprecated_zones_usage';
  message: string;
}

export interface FetchRegistryOpts {
  token: string;
  signal?: AbortSignal;
}

export interface ValidateInput {
  operations: EditOperation[];
  currentSnapshot?: Record<string, unknown>;
  registry: Record<string, ComponentSchema>;
  config?: {
    rootKey?: string;
    contentKey?: string;
    zonesKey?: string;
    warnOnZonesUsage?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Structure Validator Types (PROPOSAL-010)
// ---------------------------------------------------------------------------

export interface TemplateComponent {
  type: string;
  props: { id?: string; [key: string]: unknown };
}

export interface TemplateSnapshot {
  content: TemplateComponent[];
  root: {
    props: {
      _pinMap?: Record<string, boolean>;
      /**
       * Per-slot authority default, keyed by slot id (a component's `props.id`).
       * A slot absent from the map defaults to `canonical`. An individual
       * translation may override this per prop in its localization edge metadata.
       */
      _localeAuthority?: Record<string, Authority>;
      [key: string]: unknown;
    };
  };
  zones?: Record<string, TemplateComponent[]>;
}

export interface StructuralConformanceError {
  code:
    | 'missing_pinned_component'
    | 'pinned_component_out_of_order'
    | 'unexpected_component_at_pinned_slot';
  message: string;
  componentType: string;
  expectedIndex?: number;
  actualIndex?: number;
}

export interface ValidateStructureInput {
  documentSnapshot: Record<string, unknown>;
  templateSnapshot: unknown;
}

/**
 * Severity stamped on an authority diagnostic. `warning` surfaces a
 * canonical-authority write without blocking it; `error` marks it a violation.
 */
export type AuthoritySeverity = 'warning' | 'error';

/**
 * Per-prop authority overrides on a translation's localization edge, nested by
 * slot id then prop name. An entry breaks that prop's inheritance from the
 * slot's template default.
 */
export type AuthorityOverrideMap = Record<string, Record<string, Authority>>;

/**
 * A diagnostic raised when a write targets a prop whose effective authority is
 * `canonical` — a prop the translation does not own. `authority` carries that
 * resolved authority, so a consumer branches on it without re-deriving it.
 */
export interface AuthorityDiagnostic {
  opIndex: number;
  path: string;
  code: 'canonical_authority_write';
  severity: AuthoritySeverity;
  slotId: string;
  propName: string;
  authority: Authority;
  message: string;
}

export interface ValidateTranslationAuthorityInput {
  operations: EditOperation[];
  currentSnapshot: Record<string, unknown>;
  /** Template snapshot supplying each slot's `_localeAuthority` default. */
  templateSnapshot: unknown;
  /**
   * Per-slot defaults for a caller holding the resolved map rather than the
   * template it came from. Consulted before `templateSnapshot`; a slot named by
   * neither defaults to `canonical`.
   */
  slotAuthority?: Record<string, Authority>;
  /** Per-prop overrides from the localization edge; absent props follow the default. */
  authorityOverrides?: AuthorityOverrideMap;
  /** Severity to stamp on emitted diagnostics. Defaults to `warning`. */
  severity?: AuthoritySeverity;
}
