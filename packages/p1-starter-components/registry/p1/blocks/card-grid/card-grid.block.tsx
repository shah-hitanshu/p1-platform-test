import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta, wireframe } from '../define-meta';
import { CardGridRender, type CardGridProps, type CardGridItem } from "./card-grid";
export type { CardGridProps, CardGridItem };

export const CardGridBlock: ComponentConfig<CardGridProps> = {
  fields: {
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "A short section heading of 2–5 words. Plain text, sentence case." },
    },
    columns: {
      type: "select" as const,
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    items: {
      type: "array" as const,
      arrayFields: {
        title: { type: "text" as const, contentEditable: true, visible: false },
        subtitle: { type: "text" as const, contentEditable: true, visible: false },
        imageUrl: { type: "text" as const },
      },
      defaultItemProps: {
        title: "Company",
        subtitle: "Industry · Result",
        imageUrl: wireframe(600, 400),
      },
      getItemSummary: (item: CardGridItem) => item.title || "Card",
    },
  },
  defaultProps: {
    heading: "Customer stories",
    columns: "3",
    items: [
      { title: "Northwind", subtitle: "Retail · 38% faster launches", imageUrl: wireframe(600, 400) },
      { title: "Atlas Media", subtitle: "Publishing · 2M monthly reads", imageUrl: wireframe(600, 400) },
      { title: "Brightline", subtitle: "SaaS · 4.9/5 satisfaction", imageUrl: wireframe(600, 400) },
    ],
  },
  render: CardGridRender,
};

export const meta = defineMeta({
  title: 'Card Grid',
  description: 'Responsive 2–4 column grid of image+title+subtitle cards with an optional section heading; use for feature or product showcases.',
  categories: ["showcase"],
  published: true,
});
