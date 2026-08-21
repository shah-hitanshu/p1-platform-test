import type { ComponentConfig } from "@puckeditor/core";
import { LeadCaptureRender, type LeadCaptureProps } from "./lead-capture";
export type { LeadCaptureProps };

export const LeadCaptureBlock: ComponentConfig<LeadCaptureProps> = {
  fields: {
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short, compelling heading. Under 6 words." },
    },
    subtitle: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "1 sentence of context below the heading." },
    },
    placeholder: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Input placeholder text. E.g. you@company.com." },
    },
    buttonLabel: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "CTA button label. 1–3 words." },
    },
    note: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Trust line below the form. E.g. No spam. Unsubscribe anytime." },
    },
    tone: {
      type: "select" as const,
      options: [
        { label: "Light", value: "light" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
        { label: "Yellow", value: "yellow" },
      ],
    },
    layout: {
      type: "radio" as const,
      options: [
        { label: "Inline", value: "inline" },
        { label: "Stacked", value: "stacked" },
      ],
    },
  },
  defaultProps: {
    heading: "Stay in the loop.",
    subtitle: "Occasional updates, straight to your inbox.",
    placeholder: "you@company.com",
    buttonLabel: "Subscribe",
    note: "No spam. Unsubscribe anytime.",
    tone: "purple",
    layout: "inline",
  },
  render: LeadCaptureRender,
};
