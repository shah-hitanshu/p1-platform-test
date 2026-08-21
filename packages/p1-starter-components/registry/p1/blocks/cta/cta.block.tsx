import type { ComponentConfig } from "@puckeditor/core";
import { CtaBannerRender, type CtaBannerProps } from "./cta";
export type { CtaBannerProps };

export const CtaBannerBlock: ComponentConfig<CtaBannerProps> = {
  fields: {
    eyebrow: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label above the title. 1–4 words. Leave blank to omit." },
    },
    title: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "CTA headline. Bold claim, under 8 words." },
    },
    subtitle: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "1–2 sentence supporting line below the headline." },
    },
    buttonLabel: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Primary CTA label. 2–5 words. E.g. Start free trial." },
    },
    secondaryLabel: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Optional secondary link label. E.g. See a demo. Leave blank to omit." },
    },
    layout: {
      type: "select" as const,
      options: [
        { label: "Centered", value: "centered" },
        { label: "Split", value: "split" },
      ],
    },
    align: {
      type: "radio" as const,
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    tone: {
      type: "select" as const,
      options: [
        { label: "Yellow", value: "yellow" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
        { label: "Light", value: "light" },
        { label: "Gradient", value: "gradient" },
        { label: "Outline", value: "outline" },
      ],
    },
    decoration: {
      type: "select" as const,
      options: [
        { label: "None", value: "none" },
        { label: "Glow", value: "glow" },
        { label: "Dots", value: "dots" },
      ],
    },
    corners: {
      type: "select" as const,
      options: [
        { label: "Square", value: "square" },
        { label: "Soft", value: "soft" },
        { label: "Round", value: "round" },
      ],
    },
    padding: {
      type: "select" as const,
      options: [
        { label: "Compact", value: "compact" },
        { label: "Regular", value: "regular" },
        { label: "Spacious", value: "spacious" },
      ],
    },
  },
  defaultProps: {
    eyebrow: "",
    title: "Ready to ship faster?",
    subtitle: "Start a free trial — no credit card, no deploy pipeline to wrangle.",
    buttonLabel: "Start free trial",
    secondaryLabel: "",
    layout: "centered",
    align: "center",
    tone: "yellow",
    decoration: "none",
    corners: "round",
    padding: "regular",
  },
  render: CtaBannerRender,
};
