import type { ComponentConfig } from "@puckeditor/core";
import { PullQuoteRender, type PullQuoteProps } from "./pull-quote";
export type { PullQuoteProps };

export const PullQuoteBlock: ComponentConfig<PullQuoteProps> = {
  fields: {
    quote: {
      type: "richtext" as const,
      contentEditable: true,
      visible: false,
      ai: {
        instructions:
          "A memorable pull quote, 15–35 words. May use <mark> to highlight 2–5 key words. No other formatting.",
      },
    },
    cite: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Attribution. Format: Full Name, Role or Title." },
    },
    accent: {
      type: "select" as const,
      options: [
        { label: "Yellow rule", value: "yellow rule" },
        { label: "Quote mark", value: "quote mark" },
        { label: "None", value: "none" },
      ],
    },
    align: {
      type: "radio" as const,
      options: [
        { label: "Center", value: "center" },
        { label: "Left", value: "left" },
      ],
    },
  },
  defaultProps: {
    quote:
      "The best workflow is the one your whole team <mark>actually uses</mark> — not the one that looks impressive in a diagram.",
    cite: "Jordan Ellis, Operations Lead",
    accent: "yellow rule",
    align: "center",
  },
  render: PullQuoteRender,
};
