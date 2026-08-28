import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta, wireframe } from '../define-meta';
import { FeatureMediaRender, type FeatureMediaProps, type FeatureMediaBullet } from "./feature-media";
export type { FeatureMediaProps, FeatureMediaBullet };

export const FeatureMediaBlock: ComponentConfig<FeatureMediaProps> = {
  fields: {
    eyebrow: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label above the heading. 2–4 words. E.g. How it works." },
    },
    title: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Section heading. Punchy claim, under 10 words." },
    },
    body: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "1–2 sentence description supporting the heading." },
    },
    bullets: {
      type: "array" as const,
      arrayFields: {
        text: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "One benefit, 4–8 words." },
        },
      },
      defaultItemProps: { text: "Benefit" },
      getItemSummary: (item: FeatureMediaBullet) => item.text || "Bullet",
    },
    buttonLabel: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "CTA label. 3–6 words. E.g. See how it works →" },
    },
    imageSrc: {
      type: "text" as const,
      ai: { exclude: true },
    },
    mediaSide: {
      type: "radio" as const,
      options: [
        { label: "Right", value: "right" },
        { label: "Left", value: "left" },
      ],
    },
    tone: {
      type: "select" as const,
      options: [
        { label: "White", value: "white" },
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ],
    },
  },
  defaultProps: {
    eyebrow: "How it works",
    title: "Designed around the way you work.",
    body: "Move from idea to published in a few clicks. Preview every change, then make it live whenever you're ready.",
    bullets: [
      { text: "Visual, on-brand editing" },
      { text: "Preview before you publish" },
      { text: "Publish in one click" },
    ],
    buttonLabel: "See how it works →",
    imageSrc: wireframe(1000, 563),
    mediaSide: "right",
    tone: "white",
  },
  render: FeatureMediaRender,
};

export const meta = defineMeta({
  title: 'Feature Media',
  description: 'Side-by-side text+image block with eyebrow, title, body, bullet points, and a CTA button; use for product feature highlights.',
  categories: ["value"],
  registryDependencies: ["@p1/tokens","@p1/internal-btn","@p1/internal-icons"],
});
