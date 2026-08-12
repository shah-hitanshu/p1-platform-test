"use client";

import { type ReactElement } from "react";
import { createUsePuck, FieldLabel } from "@puckeditor/core";
import { Select } from "@pantheon-systems/pds-toolkit-react";
import { useDatasourceRegistry, useDatasourceData } from "./datasource-select-field.js";

const usePuckState = createUsePuck();

interface SchemaSelectFieldDef {
  type: "custom";
  label: string;
  render: (props: {
    field: SchemaSelectFieldDef;
    name: string;
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
  }) => ReactElement;
}

interface SchemaSelectFieldOptions {
  label?: string;
  datasourcePropName?: string;
  fallbackFields?: { path: string; description: string }[];
  togglePropName?: string;
  required?: boolean;
  typeHint?: string;
}

export function extractFieldPaths(
  obj: Record<string, unknown>,
  prefix = "",
  maxDepth = 4,
): { path: string; description: string }[] {
  if (maxDepth <= 0) return [];
  const results: { path: string; description: string }[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      results.push(
        ...extractFieldPaths(
          value as Record<string, unknown>,
          fullPath,
          maxDepth - 1,
        ),
      );
    } else {
      const desc =
        Array.isArray(value)
          ? `Array (${value.length} items)`
          : typeof value === "string"
            ? value.length > 40
              ? `${typeof value} (${value.length} chars)`
              : String(value)
            : String(value ?? "");
      results.push({ path: fullPath, description: desc });
    }
  }
  return results;
}

export function createSchemaSelectField(
  options?: SchemaSelectFieldOptions,
): SchemaSelectFieldDef {
  const label = options?.label ?? "Schema field";
  const datasourcePropName = options?.datasourcePropName ?? "datasourceId";
  const fallbackFields = options?.fallbackFields;
  const togglePropName = options?.togglePropName;
  const required = options?.required ?? false;
  const typeHint = options?.typeHint;

  return {
    type: "custom" as const,
    label,
    render({ label: fieldLabel, value, onChange, readOnly }) {
      const inner = (
        <SchemaSelectFieldInner
          value={value ?? ""}
          onChange={onChange}
          readOnly={readOnly}
          datasourcePropName={datasourcePropName}
          fallbackFields={fallbackFields}
          togglePropName={togglePropName}
        />
      );

      if (required || typeHint) {
        return (
          <div className="p1-schema-field">
            <div className="p1-schema-field__label-row">
              <span className="p1-schema-field__label">
                {fieldLabel}
                {required && <span className="p1-schema-field__required"> *</span>}
              </span>
              {typeHint && (
                <span className="p1-schema-field__type-hint">{typeHint}</span>
              )}
            </div>
            {inner}
          </div>
        );
      }

      return <FieldLabel label={fieldLabel}>{inner}</FieldLabel>;
    },
  };
}

function SchemaSelectFieldInner({
  value,
  onChange,
  readOnly,
  datasourcePropName,
  fallbackFields,
  togglePropName,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  datasourcePropName: string;
  fallbackFields?: { path: string; description: string }[];
  togglePropName?: string;
}) {
  const selectedItem = usePuckState((s) => s.selectedItem) as {
    type: string;
    props: Record<string, unknown>;
  } | null;

  const dispatch = usePuckState((s) => s.dispatch) as (action: {
    type: string;
    [key: string]: unknown;
  }) => void;

  const getItemById = usePuckState((s) => s.getItemById) as
    | ((id: string) => { type: string; props: Record<string, unknown> } | undefined)
    | undefined;

  const getSelectorForId = usePuckState((s) => s.getSelectorForId) as
    | ((id: string) => { zone: string; index: number } | undefined)
    | undefined;

  const registry = useDatasourceRegistry();
  const datasourceContext = useDatasourceData();

  const toggleValue = togglePropName
    ? !!selectedItem?.props?.[togglePropName]
    : false;
  const componentId = selectedItem?.props?.id as string | undefined;

  function handleToggleChange(checked: boolean) {
    if (readOnly || !togglePropName || !componentId) return;
    const item = getItemById?.(componentId);
    const selector = getSelectorForId?.(componentId);
    if (!item || !selector) return;
    dispatch({
      type: "replace",
      destinationIndex: selector.index,
      destinationZone: selector.zone,
      data: { ...item, props: { ...item.props, [togglePropName]: checked } },
    });
  }

  const datasourceId = selectedItem?.props?.[datasourcePropName] as
    | string
    | undefined;

  const datasource = datasourceId
    ? registry.find((ds) => ds.id === datasourceId)
    : undefined;

  let fields: { path: string; description: string }[] = [];

  if (datasourceId && datasourceContext[datasourceId]) {
    const dsData = datasourceContext[datasourceId] as Record<string, unknown>;
    const items = dsData?.items;
    if (Array.isArray(items) && items.length > 0) {
      fields = extractFieldPaths(items[0] as Record<string, unknown>);
    } else {
      fields = extractFieldPaths(dsData);
    }
  }

  if (datasource) {
    const rawFields = datasource.fields ?? [];
    const ITEM_PREFIXES = ["items.0.", "items[]."];
    const itemFields: typeof rawFields = [];
    for (const f of rawFields) {
      const prefix = ITEM_PREFIXES.find((p) => f.path.startsWith(p));
      if (prefix) {
        itemFields.push({ ...f, path: f.path.slice(prefix.length) });
      }
    }
    const staticFields = itemFields.length > 0 ? itemFields : rawFields;
    if (fields.length === 0) {
      fields = staticFields;
    } else if (itemFields.length > 0) {
      const seen = new Set(fields.map((f) => f.path));
      for (const sf of itemFields) {
        if (!seen.has(sf.path)) {
          fields.push(sf);
        }
      }
    }
  }

  const toggle = togglePropName ? (
    <button
      type="button"
      role="switch"
      aria-checked={toggleValue}
      aria-label={toggleValue ? "Hide field" : "Show field"}
      className={`p1-eye-toggle${toggleValue ? "" : " p1-eye-toggle--off"}`}
      disabled={readOnly}
      onClick={() => handleToggleChange(!toggleValue)}
    >
      {toggleValue ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      )}
    </button>
  ) : null;

  if (!datasourceId || fields.length === 0) {
    if (fallbackFields && fallbackFields.length > 0) {
      const fallbackOptions = [
        { label: "None", value: "" },
        ...fallbackFields.map((f) => ({
          label: f.path,
          value: `{{ item.${f.path} }}`,
        })),
      ];
      return (
        <div className="p1-schema-select-row">
          <div className="p1-schema-select-row__control">
            <Select
              value={value}
              options={fallbackOptions}
              onOptionSelect={(opt) => onChange(opt.value)}
              disabled={readOnly}
            />
          </div>
          {toggle}
        </div>
      );
    }

    return (
      <div className="p1-schema-select-row">
        <div className="p1-schema-select-row__control">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={readOnly}
            placeholder="{{ item.fieldName }}"
          />
        </div>
        {toggle}
      </div>
    );
  }

  const selectOptions = [
    { label: "None", value: "" },
    ...fields.map((f) => ({
      label: f.path,
      value: `{{ item.${f.path} }}`,
    })),
  ];

  return (
    <div className="p1-schema-select-row">
      <div className="p1-schema-select-row__control">
        <Select
          value={value}
          options={selectOptions}
          onOptionSelect={(opt) => onChange(opt.value)}
          disabled={readOnly}
        />
      </div>
      {toggle}
    </div>
  );
}
