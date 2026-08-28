import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '../define-meta';
import { ColumnsRender, type ColumnsProps } from "./columns";
export type { ColumnsProps };

export const ColumnsBlock: ComponentConfig<ColumnsProps> = {
  fields: {
    distribution: {
      type: "select" as const,
      options: [
        { label: "Two — even", value: "1:1" },
        { label: "Two — left wide", value: "2:1" },
        { label: "Two — right wide", value: "1:2" },
        { label: "Three", value: "1:1:1" },
        { label: "Four", value: "1:1:1:1" },
      ],
    },
    gap: {
      type: "select" as const,
      options: [
        { label: "Tight", value: "tight" },
        { label: "Regular", value: "regular" },
        { label: "Wide", value: "wide" },
      ],
    },
    valign: {
      type: "select" as const,
      options: [
        { label: "Top", value: "top" },
        { label: "Center", value: "center" },
        { label: "Stretch", value: "stretch" },
      ],
    },
    tone: {
      type: "radio" as const,
      options: [
        { label: "None", value: "none" },
        { label: "Light", value: "light" },
      ],
    },
    col1: { type: "slot" as const },
    col2: { type: "slot" as const },
    col3: { type: "slot" as const },
    col4: { type: "slot" as const },
  },
  defaultProps: {
    distribution: "1:1",
    gap: "regular",
    valign: "top",
    tone: "none",
    col1: [],
    col2: [],
    col3: [],
    col4: [],
  },
  render: ColumnsRender as unknown as ComponentConfig<ColumnsProps>["render"],
};

export const meta = defineMeta({
  title: 'Columns',
  description: 'Drag-and-drop layout grid of 2–4 columns with configurable ratio, gap, and vertical alignment; use as a layout wrapper for other blocks.',
  categories: ["layout"],
  published: true,
});
