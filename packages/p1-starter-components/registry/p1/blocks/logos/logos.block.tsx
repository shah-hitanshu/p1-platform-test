import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '@/registry/p1/internal/define-meta';
import { P1_LOGO } from '@/registry/p1/internal/assets';
import { LogoCloudRender, type LogoCloudProps, type LogoItem } from "./logos";
export type { LogoCloudProps, LogoItem };

export const LogoCloudBlock: ComponentConfig<LogoCloudProps> = {
  fields: {
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label above the logos. E.g. Featured in or Trusted by." },
    },
    style: {
      type: "radio" as const,
      options: [
        { label: "Mono", value: "mono" },
        { label: "Color", value: "color" },
      ],
    },
    height: {
      type: "select" as const,
      options: [
        { label: "Small", value: "small" },
        { label: "Medium", value: "medium" },
        { label: "Large", value: "large" },
      ],
    },
    logos: {
      type: "array" as const,
      arrayFields: {
        src: {
          type: "text" as const,
          ai: { exclude: true },
        },
        label: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Brand or publication name. E.g. Reuters." },
        },
      },
      defaultItemProps: { src: "", label: "Brand" },
      getItemSummary: (item: LogoItem) => item.label || "Logo",
    },
  },
  defaultProps: {
    heading: "Trusted by teams like",
    style: "mono",
    height: "medium",
    logos: [
      { src: P1_LOGO, label: "Company 1" },
      { src: P1_LOGO, label: "Company 2" },
      { src: P1_LOGO, label: "Company 3" },
      { src: P1_LOGO, label: "Company 4" },
    ],
  },
  render: LogoCloudRender,
};

export const meta = defineMeta({
  title: 'Logo Cloud',
  description: 'Logo cloud row/grid of partner or customer logos in mono or color style with optional heading; use for social-proof or partner sections.',
  categories: ["trust"],
  published: true,
});
