import type { ComponentConfig } from "@puckeditor/core";
import { Spacer, type SpacerProps } from "./spacer";
export type { SpacerProps };

export const SpacerBlock: ComponentConfig<SpacerProps> = {
  fields: {
    size: {
      type: "select" as const,
      options: [
        { label: "Extra Small", value: "xs" },
        { label: "Small", value: "sm" },
        { label: "Medium", value: "md" },
        { label: "Large", value: "lg" },
        { label: "Extra Large", value: "xl" },
      ],
    },
  },
  defaultProps: {
    size: "md",
  },
  render: Spacer,
};
