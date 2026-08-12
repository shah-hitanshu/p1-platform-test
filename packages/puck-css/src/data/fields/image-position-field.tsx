"use client";

import { type ReactElement } from "react";
import { createUsePuck, FieldLabel } from "@puckeditor/core";
import { Select } from "@pantheon-systems/pds-toolkit-react";

const usePuckState = createUsePuck();

interface ImagePositionOption {
  label: string;
  value: string;
}

const IMAGE_POSITION_OPTIONS: Record<string, ImagePositionOption[]> = {
  grid: [
    { label: "Top", value: "top" },
    { label: "Left", value: "left" },
    { label: "Right", value: "right" },
    { label: "Backdrop", value: "backdrop" },
    { label: "None", value: "none" },
  ],
  table: [
    { label: "Left", value: "left" },
    { label: "None", value: "none" },
  ],
  list: [
    { label: "Left", value: "left" },
    { label: "Right", value: "right" },
    { label: "None", value: "none" },
  ],
};

const IMAGE_POSITION_DEFAULTS: Record<string, string> = {
  grid: "top",
  table: "left",
  list: "left",
};

export function clampImagePosition(
  viewMode: string,
  position: string,
  customPositions?: Record<string, ImagePositionOption[]>,
): string {
  const posMap = customPositions ?? IMAGE_POSITION_OPTIONS;
  const options = posMap[viewMode];
  if (!options) {
    const firstKey = Object.keys(posMap)[0];
    const fallback = (firstKey ? posMap[firstKey] : undefined) ?? [];
    const fallbackDefault = fallback[0]?.value ?? "top";
    return fallback.some((o) => o.value === position)
      ? position
      : fallbackDefault;
  }
  const modeDefault = customPositions
    ? options[0]?.value ?? "top"
    : (IMAGE_POSITION_DEFAULTS[viewMode] ?? "top");
  return options.some((o) => o.value === position) ? position : modeDefault;
}

interface ImagePositionFieldDef {
  type: "custom";
  label: string;
  render: (props: {
    field: ImagePositionFieldDef;
    name: string;
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
  }) => ReactElement;
}

interface ImagePositionFieldOptions {
  label?: string;
  modePropName?: string;
  visibleWhenPropName?: string;
  modePositions?: Record<string, ImagePositionOption[]>;
}

export function createImagePositionField(
  options?: ImagePositionFieldOptions,
): ImagePositionFieldDef {
  const label = options?.label ?? "Image position";
  const modePropName = options?.modePropName ?? "viewMode";
  const visibleWhenPropName = options?.visibleWhenPropName;
  const modePositions = options?.modePositions;

  return {
    type: "custom" as const,
    label,
    render({ label: fieldLabel, value, onChange, readOnly }) {
      return (
        <ImagePositionFieldInner
          label={fieldLabel}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          modePropName={modePropName}
          visibleWhenPropName={visibleWhenPropName}
          modePositions={modePositions}
        />
      );
    },
  };
}

function ImagePositionFieldInner({
  label,
  value,
  onChange,
  readOnly,
  modePropName,
  visibleWhenPropName,
  modePositions,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  modePropName: string;
  visibleWhenPropName?: string;
  modePositions?: Record<string, ImagePositionOption[]>;
}) {
  const selectedItem = usePuckState((s) => s.selectedItem) as {
    type: string;
    props: Record<string, unknown>;
  } | null;

  if (visibleWhenPropName && !selectedItem?.props?.[visibleWhenPropName]) {
    return null;
  }

  const posMap = modePositions ?? IMAGE_POSITION_OPTIONS;
  const defaultMode = Object.keys(posMap)[0] ?? "grid";
  const viewMode =
    (selectedItem?.props?.[modePropName] as string | undefined) ?? defaultMode;
  const options = posMap[viewMode] ?? posMap[defaultMode] ?? [];

  return (
    <FieldLabel label={label}>
      <Select
        value={value}
        options={options}
        onOptionSelect={(opt) => onChange(opt.value)}
        disabled={readOnly}
      />
    </FieldLabel>
  );
}
