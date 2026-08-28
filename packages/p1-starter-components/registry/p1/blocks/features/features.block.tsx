import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '../define-meta';
import { FeatureCardsRender, type FeatureCardsProps, type FeatureCard } from "./features";
export type { FeatureCardsProps, FeatureCard };

export const FeatureCardsBlock: ComponentConfig<FeatureCardsProps> = {
  fields: {
    subtitle: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short eyebrow / section label above the heading. 3–6 words, italic feel." },
    },
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Section heading. Bold claim, under 10 words." },
    },
    cards: {
      type: "array" as const,
      arrayFields: {
        eyebrow: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "1–2 word label for this card. Title case." },
        },
        title: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Card title. 3–5 words." },
        },
        body: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "1–2 sentence description of this feature." },
        },
      },
      defaultItemProps: { eyebrow: "Eyebrow", title: "Feature", body: "Describe the feature." },
      getItemSummary: (item: FeatureCard) => item.title || "Card",
    },
    columns: {
      type: "select" as const,
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    colorScheme: {
      type: "select" as const,
      options: [
        { label: "Brand mix", value: "brand mix" },
        { label: "Light", value: "light" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
        { label: "Outline", value: "outline" },
      ],
    },
    corners: {
      type: "select" as const,
      options: [
        { label: "Sharp", value: "sharp" },
        { label: "Soft", value: "soft" },
        { label: "Round", value: "round" },
      ],
    },
    depth: {
      type: "select" as const,
      options: [
        { label: "Flat", value: "flat" },
        { label: "Subtle", value: "subtle" },
        { label: "Raised", value: "raised" },
      ],
    },
    cardAlign: {
      type: "radio" as const,
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    sectionBg: {
      type: "select" as const,
      options: [
        { label: "Light", value: "light" },
        { label: "White", value: "white" },
        { label: "Dark", value: "dark" },
        { label: "None", value: "none" },
      ],
    },
  },
  defaultProps: {
    subtitle: "Why teams choose us",
    heading: "Everything you need, in one place.",
    cards: [
      { eyebrow: "Simple", title: "Easy to use", body: "A visual editor anyone on your team can pick up in minutes — no training required." },
      { eyebrow: "Flexible", title: "Built to scale", body: "Start with one page and grow to hundreds — everything stays consistent as you go." },
      { eyebrow: "Reliable", title: "Always on", body: "Fast, secure, and dependable — so you can focus on your content, not your infrastructure." },
    ],
    columns: "3",
    colorScheme: "brand mix",
    corners: "round",
    depth: "flat",
    cardAlign: "left",
    sectionBg: "light",
  },
  render: FeatureCardsRender,
};

export const meta = defineMeta({
  title: 'Feature Cards',
  description: 'Grid of 2–4 feature cards each with eyebrow, title, and body in multiple color schemes and card styles; use for feature lists or benefit grids.',
  categories: ["value"],
});
