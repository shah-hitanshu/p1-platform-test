import type { ComponentConfig } from "@puckeditor/core";
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
    heading: "Featured in",
    style: "mono",
    height: "medium",
    logos: [
      { src: "", label: "NPR" },
      { src: "", label: "PBS" },
      { src: "", label: "REUTERS" },
      { src: "", label: "NATURE" },
    ],
  },
  render: LogoCloudRender,
};
