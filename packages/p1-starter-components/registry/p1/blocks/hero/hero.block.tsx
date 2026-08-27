import type { ComponentConfig } from "@puckeditor/core";
import { HeroRender, type HeroProps } from "./hero";
export type { HeroProps };

export const HeroBlock: ComponentConfig<HeroProps> = {
  fields: {
    eyebrow: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short badge label above the headline. 2–5 words. E.g. Now available. Leave blank to omit." },
    },
    title: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Main headline. Bold claim, under 8 words." },
    },
    description: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "1–2 sentence supporting text below the headline." },
    },
    primaryLabel: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Primary CTA label. 2–5 words." },
    },
    secondaryLabel: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Secondary link label. E.g. Book a demo →. Leave blank to omit." },
    },
    imageSrc: {
      type: "text" as const,
      ai: { exclude: true },
    },
    tone: {
      type: "select" as const,
      options: [
        { label: "Accent", value: "accent" },
        { label: "Dark", value: "dark" },
        { label: "Light", value: "light" },
      ],
    },
    layout: {
      type: "select" as const,
      options: [
        { label: "Split", value: "split" },
        { label: "Full image", value: "full image" },
        { label: "Text only", value: "text only" },
      ],
    },
    imageSide: {
      type: "radio" as const,
      options: [
        { label: "Right", value: "right" },
        { label: "Left", value: "left" },
      ],
    },
    imageFill: {
      type: "radio" as const,
      options: [
        { label: "Card", value: "card" },
        { label: "Flush", value: "flush" },
      ],
    },
    splitRatio: {
      type: "select" as const,
      options: [
        { label: "Even", value: "even" },
        { label: "Copy-wide", value: "copy-wide" },
        { label: "Image-wide", value: "image-wide" },
      ],
    },
    align: {
      type: "select" as const,
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },
    overlay: {
      type: "select" as const,
      options: [
        { label: "None", value: "none" },
        { label: "Scrim", value: "scrim" },
        { label: "Gradient ↓", value: "gradient down" },
        { label: "Gradient →", value: "gradient right" },
      ],
    },
    overlayStrength: {
      type: "select" as const,
      options: [
        { label: "Light", value: "light" },
        { label: "Medium", value: "medium" },
        { label: "Heavy", value: "heavy" },
      ],
    },
    knockout: {
      type: "radio" as const,
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
  },
  defaultProps: {
    eyebrow: "New — now available",
    title: "Your big idea, beautifully online.",
    description:
      "A flexible starting point for your next page. Swap in your own headline, story, and imagery — this layout adapts to whatever you publish.",
    primaryLabel: "Start free trial",
    secondaryLabel: "Book a demo →",
    tone: "accent",
    layout: "split",
    imageSrc: "https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1200&q=80",
    imageSide: "right",
    imageFill: "card",
    splitRatio: "even",
    align: "left",
    overlay: "gradient right",
    overlayStrength: "medium",
    knockout: "off",
  },
  render: HeroRender,
};
