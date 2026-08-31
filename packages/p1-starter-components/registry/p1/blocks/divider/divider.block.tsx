import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '@/registry/p1/internal/define-meta';
import { Divider, type DividerProps } from "./divider";
export type { DividerProps };

export const DividerBlock: ComponentConfig<DividerProps> = {
  fields: {
    style: {
      type: "select",
      options: [
        { label: "Solid", value: "solid" },
        { label: "Dashed", value: "dashed" },
        { label: "Dots", value: "dots" },
      ],
    } as const,
    spacing: {
      type: "select",
      options: [
        { label: "Small", value: "small" },
        { label: "Medium", value: "medium" },
        { label: "Large", value: "large" },
      ],
    } as const,
  },
  defaultProps: { style: "solid", spacing: "medium" },
  render: Divider,
};

export const meta = defineMeta({
  title: 'Divider',
  description: 'Horizontal rule in solid, dashed, or dot styles with configurable vertical spacing; use to visually separate page sections.',
  categories: ["content"],
  published: true,
});
