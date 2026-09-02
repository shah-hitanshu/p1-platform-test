import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '@/registry/p1/internal/define-meta';
import { TimelineRender, type TimelineProps, type TimelineItem } from "./timeline";
export type { TimelineProps, TimelineItem };

export const TimelineBlock: ComponentConfig<TimelineProps> = {
  fields: {
    eyebrow: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label above the heading. 2–4 words. E.g. Our story." },
    },
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Section heading. Evocative, under 8 words." },
    },
    layout: {
      type: "select" as const,
      options: [
        { label: "Vertical", value: "vertical" },
        { label: "Alternating", value: "alternating" },
      ],
    },
    tone: {
      type: "radio" as const,
      options: [
        { label: "White", value: "white" },
        { label: "Light", value: "light" },
      ],
    },
    items: {
      type: "array" as const,
      arrayFields: {
        date: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Year or short date label. E.g. 2021 or Q3 2023." },
        },
        title: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Milestone name. 3–6 words." },
        },
        body: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "1–2 sentence description of what happened." },
        },
      },
      defaultItemProps: { date: "Year", title: "Milestone", body: "What happened." },
      getItemSummary: (item: TimelineItem) => item.title || "Milestone",
    },
  },
  defaultProps: {
    eyebrow: "Our story",
    heading: "How we got here.",
    layout: "vertical",
    tone: "white",
    items: [
      { date: "2019", title: "The first commit", body: "Two engineers, one repo, and a stubborn belief that shipping should be simple." },
      { date: "2021", title: "Multidev arrives", body: "Parallel environments for every branch — review without stepping on each other." },
      { date: "2023", title: "100,000 sites", body: "Teams across publishing, higher ed, and government make the switch." },
      { date: "2026", title: "One workflow for everyone", body: "Developers, marketers, and IT finally share a single way to build and run the web." },
    ],
  },
  render: TimelineRender,
};

export const meta = defineMeta({
  title: 'Timeline',
  description: 'Vertical or alternating chronological list of date+title+body events; use for company history, product roadmaps, or process timelines.',
  categories: ["value"],
  published: true,
});
