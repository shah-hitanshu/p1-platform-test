import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '@/registry/p1/internal/define-meta';
import { Heading, type HeadingProps } from "./heading";
export type { HeadingProps };

export const HeadingBlock: ComponentConfig<HeadingProps> = {
  fields: {
    text: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "A section heading of 2-6 words. Plain text, sentence case, no trailing punctuation." },
    },
    level: {
      type: "select" as const,
      options: [
        { label: "H1", value: "H1" },
        { label: "H2", value: "H2" },
        { label: "H3", value: "H3" },
        { label: "H4", value: "H4" },
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
  defaultProps: { text: "A heading to anchor the section", level: "H2", align: "left" },
  render: Heading,
};

export const meta = defineMeta({
  title: 'Heading',
  description: 'Single H1–H4 heading element with left/center alignment; use to add a standalone section title.',
  categories: ["content"],
  published: true,
});
