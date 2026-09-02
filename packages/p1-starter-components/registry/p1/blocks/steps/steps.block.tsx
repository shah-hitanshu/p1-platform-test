import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '@/registry/p1/internal/define-meta';
import { StepsRender, type StepsProps, type StepItem } from "./steps";
export type { StepsProps, StepItem };

export const StepsBlock: ComponentConfig<StepsProps> = {
  fields: {
    eyebrow: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label above the heading. 2–4 words. E.g. How it works." },
    },
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Section heading. Short and directive, under 8 words." },
    },
    items: {
      type: "array" as const,
      arrayFields: {
        title: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Step name. 1–3 words, verb or noun." },
        },
        body: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "1–2 sentence description of this step." },
        },
      },
      defaultItemProps: { title: "Step", body: "Describe this step." },
      getItemSummary: (item: StepItem) => item.title || "Step",
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
    heading: "Ship in three steps.",
    items: [
      { title: "Plan", body: "Start from a template or a blank page and outline what you want to say." },
      { title: "Build", body: "Compose your page from ready-made blocks — no code required." },
      { title: "Publish", body: "Preview your changes, then make them live in a single click." },
    ],
    tone: "light",
  },
  render: StepsRender,
};

export const meta = defineMeta({
  title: 'Steps',
  description: 'Numbered sequential steps with eyebrow, heading, and title+body per step in a 1–4 column layout; use for how-it-works or onboarding flows.',
  categories: ["value"],
  published: true,
});
