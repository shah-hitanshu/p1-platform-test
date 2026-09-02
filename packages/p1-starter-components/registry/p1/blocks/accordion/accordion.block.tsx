import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '@/registry/p1/internal/define-meta';
import { AccordionRender, type AccordionProps, type AccordionItem } from "./accordion";
export type { AccordionProps, AccordionItem };

export const AccordionBlock: ComponentConfig<AccordionProps> = {
  fields: {
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "A section heading of 2–6 words. Plain text, sentence case, no trailing punctuation." },
    },
    align: {
      type: "radio" as const,
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    items: {
      type: "array" as const,
      arrayFields: {
        title: { type: "text" as const, contentEditable: true, visible: false },
        body: { type: "richtext" as const, contentEditable: true },
      },
      defaultItemProps: { title: "Section title", body: "<p>Section content.</p>" },
      getItemSummary: (item: AccordionItem) => item.title || "Section",
    },
  },
  defaultProps: {
    heading: "The details",
    align: "left",
    items: [
      {
        title: "What frameworks are supported?",
        body: "<p>WordPress, Drupal, and Next.js — all on the same platform, with the same <mark>Dev-Test-Live</mark> workflow.</p>",
      },
      {
        title: "How do environments work?",
        body: "<p>Every site gets Dev, Test, and Live — plus unlimited Multidev branches for parallel work.</p><ul><li>Isolated by default</li><li>Shareable preview URLs</li><li>One-click promotion</li></ul>",
      },
      {
        title: "Can the whole team use it?",
        body: "<p>Yes. Developers, marketers, and IT share one workflow with role-based access — no one waits on anyone else.</p>",
      },
    ],
  },
  render: AccordionRender,
};

export const meta = defineMeta({
  title: 'Accordion',
  description: 'Expandable list of title/body items with a section heading; use for collapsible content like FAQs or grouped details.',
  categories: ["layout"],
  published: true,
  registryDependencies: ["@p1/tokens","@p1/internal-icons","@p1/internal-rich"],
});
