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
