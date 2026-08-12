"use client";

import { type ReactElement } from "react";
import { FieldLabel } from "@puckeditor/core";
import { SegmentedButton } from "@pantheon-systems/pds-toolkit-react";

interface ViewModeOption {
  label: string;
  value: string;
}

interface ViewModeFieldDef {
  type: "custom";
  label: string;
  render: (props: {
    field: ViewModeFieldDef;
    name: string;
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
  }) => ReactElement;
}

export function createViewModeField(
  options: ViewModeOption[],
): ViewModeFieldDef {
  return {
    type: "custom" as const,
    label: "View mode",
    render({ label: fieldLabel, value, onChange, readOnly }) {
      return (
        <FieldLabel label={fieldLabel}>
          <SegmentedButton
            id="view-mode-selector"
            label=""
            options={options}
            value={value}
            onChange={onChange}
            disabled={readOnly}
            size="s"
          />
        </FieldLabel>
      );
    },
  };
}
