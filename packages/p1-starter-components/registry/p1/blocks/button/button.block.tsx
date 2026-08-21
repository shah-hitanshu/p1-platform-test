import type { ComponentConfig } from "@puckeditor/core";
import { Button, type ButtonProps } from "./button";
export type { ButtonProps };

export const ButtonBlock: ComponentConfig<ButtonProps> = {
  fields: {
    label: {
      type: "text" as const,
      ai: {
        instructions:
          "Call-to-action label. 2–5 words, imperative verb first. Example: 'Get started free', 'Learn more'. No trailing punctuation.",
      },
    },
    href: {
      type: "text" as const,
      ai: { exclude: true },
    },
    variant: {
      type: "select" as const,
      options: [
        { label: "Primary", value: "primary" },
        { label: "Secondary", value: "secondary" },
        { label: "Yellow", value: "yellow" },
        { label: "Purple", value: "purple" },
      ],
    },
    align: {
      type: "radio" as const,
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
  },
  defaultProps: {
    label: "Get started",
    href: "#",
    variant: "primary",
    align: "left",
  },
  render: Button,
};
