"use client";

import React, { type ReactElement } from "react";
import { FieldLabel } from "@puckeditor/core";
import {
  TextInput,
  Switch,
  SegmentedButton,
  Select,
} from "@pantheon-systems/pds-toolkit-react";
import { VisibleWhenProp } from "./visible-when.js";

interface CustomFieldDef {
  [key: string]: unknown;
  type: "custom";
  label: string;
  render: (props: {
    field: CustomFieldDef;
    name: string;
    id: string;
    label: string;
    value: unknown;
    onChange: (value: unknown) => void;
    readOnly?: boolean;
  }) => ReactElement;
}

export function createPdsTextField(label: string): CustomFieldDef {
  return {
    type: "custom" as const,
    label,
    render({ label: fieldLabel, id, value, onChange, readOnly }) {
      return (
        <FieldLabel label={fieldLabel}>
          <TextInput
            id={id}
            label={fieldLabel}
            showLabel={false}
            value={String(value ?? "")}
            onChange={(e: { target: { value: string } }) =>
              onChange(e.target.value)
            }
            disabled={readOnly}
          />
        </FieldLabel>
      );
    },
  };
}

export function createPdsNumberField(
  label: string,
  options?: { min?: number; max?: number },
): CustomFieldDef {
  return {
    type: "custom" as const,
    label,
    render({ label: fieldLabel, id, value, onChange, readOnly }) {
      return (
        <FieldLabel label={fieldLabel}>
          <TextInput
            id={id}
            label={fieldLabel}
            showLabel={false}
            type="number"
            value={String(value ?? "")}
            // min/max belong on the inner <input>; as top-level props they
            // were spread onto the wrapper div and never constrained anything.
            inputProps={{ min: options?.min, max: options?.max }}
            onChange={(e: { target: { value: string } }) => {
              const num = Number(e.target.value);
              onChange(Number.isFinite(num) ? num : 0);
            }}
            disabled={readOnly}
          />
        </FieldLabel>
      );
    },
  };
}

export function createPdsSwitchField(
  label: string,
  options?: { showLabel?: string; hideLabel?: string },
): CustomFieldDef {
  const showText = options?.showLabel ?? "Show";
  const hideText = options?.hideLabel ?? "Hide";
  return {
    type: "custom" as const,
    label,
    render({ label: fieldLabel, id, value, onChange, readOnly }) {
      return (
        <FieldLabel label={fieldLabel}>
          <Switch
            id={id}
            label={fieldLabel}
            showLabel={false}
            onLabel={showText}
            offLabel={hideText}
            showStatusLabel
            checked={!!value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange(e.target.checked)
            }
            disabled={readOnly}
          />
        </FieldLabel>
      );
    },
  };
}

export function createPdsSegmentedField(
  label: string,
  fieldOptions: { label: string; value: string }[],
  options?: { visibleWhenPropName?: string; defaultValue?: string },
): CustomFieldDef {
  return {
    type: "custom" as const,
    label,
    render({ label: fieldLabel, id, value, onChange, readOnly }) {
      const control = (
        <FieldLabel label={fieldLabel}>
          <SegmentedButton
            id={id}
            label=""
            options={fieldOptions}
            value={String(value ?? "") || (options?.defaultValue ?? "")}
            onChange={(v) => onChange(v)}
            disabled={readOnly}
            size="s"
          />
        </FieldLabel>
      );
      if (!options?.visibleWhenPropName) return control;
      return (
        <VisibleWhenProp propName={options.visibleWhenPropName}>
          {control}
        </VisibleWhenProp>
      );
    },
  };
}

export function createPdsSelectField(
  label: string,
  fieldOptions: { label: string; value: string }[],
): CustomFieldDef {
  return {
    type: "custom" as const,
    label,
    render({ label: fieldLabel, id, value, onChange, readOnly }) {
      return (
        <FieldLabel label={fieldLabel}>
          <Select
            id={id}
            label={fieldLabel}
            showLabel={false}
            value={String(value ?? "")}
            options={fieldOptions}
            onOptionSelect={(opt) => onChange(opt.value)}
            disabled={readOnly}
          />
        </FieldLabel>
      );
    },
  };
}
