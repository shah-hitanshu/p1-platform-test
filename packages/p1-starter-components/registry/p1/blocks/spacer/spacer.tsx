import type { ComponentConfig } from "@puckeditor/core";

export interface SpacerProps {
  size: "small" | "medium" | "large" | "x-large";
}

const HEIGHT: Record<SpacerProps["size"], number> = {
  small: 24,
  medium: 48,
  large: 80,
  "x-large": 128,
};

export const SpacerBlock: ComponentConfig<SpacerProps> = {
  fields: {
    size: {
      type: "select",
      options: [
        { label: "Small", value: "small" },
        { label: "Medium", value: "medium" },
        { label: "Large", value: "large" },
        { label: "X-Large", value: "x-large" },
      ],
    },
  },
  defaultProps: { size: "medium" },
  render: ({ size }) => <div style={{ height: HEIGHT[size] }} />,
};
