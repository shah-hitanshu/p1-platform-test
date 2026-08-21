import type { ComponentConfig } from "@puckeditor/core";
import { EmbedRender, type EmbedProps } from "./embed";
export type { EmbedProps };

export const EmbedBlock: ComponentConfig<EmbedProps> = {
  fields: {
    kind: {
      type: "select" as const,
      options: [
        { label: "Video", value: "video" },
        { label: "Social", value: "social" },
        { label: "Map", value: "map" },
        { label: "Generic", value: "generic" },
      ],
    },
    url: {
      type: "text" as const,
      ai: { exclude: true },
    },
    title: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short video title shown on the embed preview. Under 12 words." },
    },
    ratio: {
      type: "select" as const,
      options: [
        { label: "16 / 9", value: "16 / 9" },
        { label: "4 / 3", value: "4 / 3" },
        { label: "1 / 1", value: "1 / 1" },
      ],
    },
    caption: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Optional caption shown below the embed. 1 sentence." },
    },
    width: {
      type: "select" as const,
      options: [
        { label: "Contained", value: "contained" },
        { label: "Wide", value: "wide" },
      ],
    },
  },
  defaultProps: {
    kind: "video",
    url: "https://youtube.com/watch?v=demo",
    title: "Inside a Pantheon deploy — start to Live in 90 seconds",
    ratio: "16 / 9",
    caption: "",
    width: "wide",
  },
  render: EmbedRender,
};
