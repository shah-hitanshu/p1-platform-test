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

const TEMPLATE_FIELD_LABEL = "Template";

export function createTemplateSelectField(): TemplateSelectFieldDef {
  return {
    type: "custom" as const,
    label: TEMPLATE_FIELD_LABEL,
    render({ id, value, onChange, readOnly }) {
      return (
        <TemplateSelectFieldInner
          id={id}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      );
    },
  };
}

function TemplateSelectFieldInner({
  id,
  value,
  onChange,
  readOnly,
}: {
  id: string;
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
      id={id}
      label={TEMPLATE_FIELD_LABEL}
      showLabel={false}
      value={value}
      options={options}
      onOptionSelect={(opt) => onChange(opt.value)}
      disabled={readOnly}
    />
  );
}
