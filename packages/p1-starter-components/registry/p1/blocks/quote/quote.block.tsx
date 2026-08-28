"use client";

import type { ComponentConfig } from "@puckeditor/core";
import { richtextField } from "@pantheon-systems/puck-css/fields";
import { defineMeta } from '../define-meta';
import { Quote, type QuoteProps } from "./quote";
export type { QuoteProps };

export const QuoteBlock: ComponentConfig<QuoteProps> = {
  fields: {
    quote: richtextField,
    attribution: {
      type: "text" as const,
      ai: {
        instructions:
          "Name and optional title of the person being quoted. Example: 'Jane Smith, VP of Engineering'. 1–2 line max.",
      },
    },
    scale: {
      type: "radio" as const,
      options: [
        { label: "Standard", value: "standard" },
        { label: "Display", value: "display" },
      ],
    },
  },
  defaultProps: {
    quote:
      "The measure of intelligence is the ability to change. Adapt, evolve, and keep moving forward.",
    attribution: "Albert Einstein",
    scale: "standard",
  },
  render: Quote,
};

export const meta = defineMeta({
  title: 'Quote',
  description: 'Simple blockquote with rich-text quote and an attribution line in standard or display scale; use for inline quotations.',
  categories: ["content"],
  dependencies: ["@puckeditor/core","@pantheon-systems/puck-css"],
  registryDependencies: ["@p1/tokens","@p1/internal-rich"],
});
