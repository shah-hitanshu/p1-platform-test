"use client";

import { createContext, useContext, type ReactElement } from "react";
import { FieldLabel } from "@puckeditor/core";
import { Select } from "@pantheon-systems/pds-toolkit-react";
import type { RemoteDatasourceDefinition } from "../remote-datasources/remote-datasource-registry.js";
import type { RemoteDatasourceContext } from "../remote-datasources/loader.js";

const DatasourceRegistryContext = createContext<RemoteDatasourceDefinition[]>(
  [],
);

export function DatasourceRegistryProvider({
  registry,
  children,
}: {
  registry: RemoteDatasourceDefinition[];
  children: React.ReactNode;
}) {
  return (
    <DatasourceRegistryContext.Provider value={registry}>
      {children}
    </DatasourceRegistryContext.Provider>
  );
}

export function useDatasourceRegistry(): RemoteDatasourceDefinition[] {
  return useContext(DatasourceRegistryContext);
}

const DatasourceDataContext = createContext<RemoteDatasourceContext>({});

export function DatasourceDataProvider({
  context,
  children,
}: {
  context: RemoteDatasourceContext;
  children: React.ReactNode;
}) {
  return (
    <DatasourceDataContext.Provider value={context}>
      {children}
    </DatasourceDataContext.Provider>
  );
}

export function useDatasourceData(): RemoteDatasourceContext {
  return useContext(DatasourceDataContext);
}

interface DatasourceSelectFieldDef {
  type: "custom";
  label: string;
  render: (props: {
    field: DatasourceSelectFieldDef;
    name: string;
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    readOnly?: boolean;
  }) => ReactElement;
}

export function createDatasourceSelectField(): DatasourceSelectFieldDef {
  return {
    type: "custom" as const,
    label: "Datasource",
    render({ id, label: fieldLabel, value, onChange, readOnly }) {
      return (
        <FieldLabel label={fieldLabel}>
          <DatasourceSelectFieldInner
            id={id}
            label={fieldLabel}
            value={value}
            onChange={onChange}
            readOnly={readOnly}
          />
        </FieldLabel>
      );
    },
  };
}

function DatasourceSelectFieldInner({
  id,
  label,
  value,
  onChange,
  readOnly,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const registry = useDatasourceRegistry();

  if (registry.length === 0) {
    return <div>No datasources available</div>;
  }

  const options = [
    { label: "Select a datasource", value: "" },
    ...registry.map((ds) => ({ label: ds.label, value: ds.id })),
  ];

  return (
    <Select
      id={id}
      label={label}
      showLabel={false}
      value={value}
      options={options}
      onOptionSelect={(opt) => onChange(opt.value)}
      disabled={readOnly}
    />
  );
}
