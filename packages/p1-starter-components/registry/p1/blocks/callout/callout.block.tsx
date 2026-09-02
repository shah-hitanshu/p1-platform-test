import type { ComponentConfig } from "@puckeditor/core";
import { CalloutRender, type CalloutProps } from "./callout";
export type { CalloutProps };

export const CalloutBlock: ComponentConfig<CalloutProps> = {
  fields: {
    variant: {
      type: "select" as const,
      options: [
        { label: "Note", value: "note" },
        { label: "Info", value: "info" },
        { label: "Tip", value: "tip" },
        { label: "Warning", value: "warning" },
      ],
    },
    title: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label for the callout. 2–4 words. E.g. Try this, Good to know, Heads up." },
    },
    body: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "1–2 sentences of actionable or informative text. Plain prose." },
    },
  },
  defaultProps: {
    variant: "tip",
    title: "Try this",
    body: "Make “preview first” the default. Share the link before you publish — reviewers stop guessing and start seeing.",
  },
  render: CalloutRender,
};
