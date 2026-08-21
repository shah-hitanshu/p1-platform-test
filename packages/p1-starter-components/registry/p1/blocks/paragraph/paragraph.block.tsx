"use client";

import type { ComponentConfig } from "@puckeditor/core";
import { richtextField } from "@pantheon-systems/puck-css/fields";
import { Paragraph, type ParagraphProps } from "./paragraph";
export type { ParagraphProps };

export const ParagraphBlock: ComponentConfig<ParagraphProps> = {
  fields: {
    text: richtextField,
    style: {
      type: "radio" as const,
      options: [
        { label: "Body", value: "body" },
        { label: "Lead", value: "lead" },
      ],
    },
    size: {
      type: "select" as const,
      options: [
        { label: "Small", value: "small" },
        { label: "Regular", value: "regular" },
        { label: "Large", value: "large" },
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
    text: "This is a paragraph. Use it to expand on the heading above with a sentence or two of supporting detail — keep it clear, specific, and easy to scan.",
    style: "body",
    size: "regular",
    align: "left",
  },
  render: Paragraph,
};
