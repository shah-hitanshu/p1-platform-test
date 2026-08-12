"use client";

import React, { type ReactNode } from "react";
import { createUsePuck } from "@puckeditor/core";
import { FieldSection } from "../fields/field-section.js";
import { DATA_LIST_FIELD_GROUPS, MODE_FIELD_OWNERS, type FieldGroup } from "./field-groups.js";
import { isTemplateDatasource } from "./utils.js";

const VIEW_MODE_ITEM_LABELS: Record<string, string> = {
  grid: "Card",
  table: "Row",
  list: "Listing item",
};

const MAPPABLE_FIELDS = [
  "titleField",
  "subtitleField",
  "teaserField",
  "imageField",
  "iconField",
] as const;

const useGrouperPuck = createUsePuck();

function extractFieldName(key: string): string {
  const dollarIdx = key.lastIndexOf("$");
  if (dollarIdx >= 0) return key.slice(dollarIdx + 1);
  const dotIdx = key.lastIndexOf(".");
  if (dotIdx >= 0) return key.slice(dotIdx + 1);
  return key;
}

interface DataListFieldsGrouperProps {
  children: ReactNode;
}

export function DataListFieldsGrouper({
  children,
}: DataListFieldsGrouperProps) {
  const selectedItem = useGrouperPuck((s) => s.selectedItem) as {
    props: Record<string, unknown>;
  } | null;
  const viewMode = (selectedItem?.props?.viewMode as string) ?? "grid";
  const itemLabel = VIEW_MODE_ITEM_LABELS[viewMode] ?? viewMode;
  const datasourceId = (selectedItem?.props?.datasourceId as string) ?? "";
  const isTemplate = isTemplateDatasource(datasourceId);

  const allChildren = React.Children.toArray(children);

  const content: React.ReactNode[] = [];
  const fieldMapping: React.ReactNode[] = [];
  const layout: React.ReactNode[] = [];
  const unknown: React.ReactNode[] = [];

  for (const child of allChildren) {
    const key =
      child != null && typeof child === "object" && "key" in child
        ? (child as { key: string | null }).key
        : null;

    const fieldName = key ? extractFieldName(key) : "";
    const group: FieldGroup | undefined = DATA_LIST_FIELD_GROUPS[fieldName];

    if (group === "hidden") continue;
    if (fieldName === "status" && !isTemplate) continue;
    const modeOwner = MODE_FIELD_OWNERS[fieldName];
    if (modeOwner && modeOwner !== viewMode) continue;

    if (group === "content") {
      content.push(child);
    } else if (group === "content:fieldMapping") {
      fieldMapping.push(child);
    } else if (group === "layout") {
      layout.push(child);
    } else {
      unknown.push(child);
    }
  }

  const unmappedCount = MAPPABLE_FIELDS.filter(
    (f) => !selectedItem?.props?.[f],
  ).length;

  const contentTotal = content.length + fieldMapping.length;
  const layoutTotal = layout.length;

  return (
    <>
      {contentTotal > 0 && (
        <FieldSection label="Content" badge={contentTotal}>
          {content}
          {fieldMapping.length > 0 && (
            <div className="p1-field-mapping-section">
              <h4 className="p1-field-mapping-section__title">
                Data for each {itemLabel}
              </h4>
              <p className="p1-field-mapping-section__subtitle">
                Map the component fields to fields on the source document.
              </p>
              {fieldMapping}
              {unmappedCount > 0 && (
                <p className="p1-field-mapping-section__unmapped">
                  {unmappedCount} field{unmappedCount !== 1 ? "s" : ""} not mapped
                </p>
              )}
            </div>
          )}
        </FieldSection>
      )}
      {layoutTotal > 0 && (
        <FieldSection label="Layout & style" badge={layoutTotal}>
          {layout}
        </FieldSection>
      )}
      {unknown}
    </>
  );
}
