"use client";

import { type ReactElement } from "react";
import { Select } from "@pantheon-systems/pds-toolkit-react";
import { useP1Puck } from "../../core/P1PuckContext.js";
import { useTemplateList } from "../../features/content-type-templates/hooks/useTemplateList.js";

interface TemplateSelectFieldDef {
  type: "custom";
  label: string;
  render: (props: {
    field: TemplateSelectFieldDef;
    name: string;
    id: string;
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
  }) => ReactElement;
}

export function createTemplateSelectField(): TemplateSelectFieldDef {
  return {
    type: "custom" as const,
    label: "Template",
    render({ value, onChange, readOnly }) {
      return (
        <TemplateSelectFieldInner
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      );
    },
  };
}

function TemplateSelectFieldInner({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const { client, siteId, branchId } = useP1Puck();
  const { templates, loading } = useTemplateList(client, siteId, branchId);
  const active = templates.filter((t) => !t.deprecated);

  if (loading) {
    return <div>Loading templates…</div>;
  }

  if (active.length === 0) {
    return <div>No templates available</div>;
  }

  const options = [
    { label: "Select a template", value: "" },
    ...active.map((t) => ({ label: t.label, value: t.id })),
  ];

  return (
    <Select
      value={value}
      options={options}
      onOptionSelect={(opt) => onChange(opt.value)}
      disabled={readOnly}
    />
  );
}
