import type { ComponentConfig } from "@puckeditor/core";
import { RichTextRender, type RichTextProps } from "./rich-text";
export type { RichTextProps };

export const RichTextBlock: ComponentConfig<RichTextProps> = {
  fields: {
    content: { type: "richtext" as const, contentEditable: true, visible: false },
    measure: {
      type: "select" as const,
      options: [
        { label: "Narrow", value: "narrow" },
        { label: "Standard", value: "standard" },
        { label: "Wide", value: "wide" },
      ],
    },
    size: {
      type: "radio" as const,
      options: [
        { label: "Regular", value: "regular" },
        { label: "Large", value: "large" },
      ],
    },
    dropCap: {
      type: "radio" as const,
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
  },
  defaultProps: {
    content:
      "<p>A year ago, shipping a change meant a ticket, a queue, and a wait. Today it takes minutes — and the difference wasn't a single tool.</p>" +
      "<h2>It started with previews</h2>" +
      "<p>Every change got a shareable link before it went live. Reviewers stopped guessing and <mark>started seeing</mark>.</p>" +
      "<ul><li>Fewer round-trips between teams</li><li>Marketers unblocked from engineering</li><li>Confidence to publish on a Friday</li></ul>" +
      "<h3>The habit that stuck</h3>" +
      "<p>We made \"preview first\" the default, not the exception. Small change, large compounding effect.</p>" +
      "<blockquote>The best workflow is the one your whole team actually uses.</blockquote>",
    measure: "standard",
    size: "regular",
    dropCap: "off",
  },
  render: RichTextRender,
};
