import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '../define-meta';
import { FaqRender, type FaqProps, type FaqItem } from "./faq";
export type { FaqProps, FaqItem };

export const FaqBlock: ComponentConfig<FaqProps> = {
  fields: {
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Section heading for the FAQ. E.g. Frequently asked questions." },
    },
    items: {
      type: "array" as const,
      arrayFields: {
        q: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "A common customer question. End with a question mark." },
        },
        a: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Clear, helpful answer. 1–3 sentences." },
        },
      },
      defaultItemProps: { q: "Question?", a: "Answer." },
      getItemSummary: (item: FaqItem) => item.q || "Question",
    },
  },
  defaultProps: {
    heading: "Frequently asked questions",
    items: [
      { q: "Do I need a developer to make changes?", a: "No. Anyone on your team can edit pages visually with ready-made blocks — no code required." },
      { q: "Can I use my own components?", a: "Yes. Developers can add custom blocks once, and the whole team can reuse them." },
      { q: "How do previews work?", a: "Every change gets a shareable preview link, so you can review before publishing." },
    ],
  },
  render: FaqRender,
};

export const meta = defineMeta({
  title: 'FAQ',
  description: 'Vertically stacked question-and-answer list with a section heading and icon-decorated rows; use for support or product FAQ sections.',
  categories: ["convert"],
  published: true,
  registryDependencies: ["@p1/tokens","@p1/internal-icons"],
});
