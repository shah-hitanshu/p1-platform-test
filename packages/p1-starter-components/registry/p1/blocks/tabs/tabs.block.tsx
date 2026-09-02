import type { ComponentConfig } from "@puckeditor/core";
import { TabsRender, type TabsProps, type TabItem } from "./tabs";
export type { TabsProps, TabItem };

export const TabsBlock: ComponentConfig<TabsProps> = {
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
    tabs: {
      type: "array" as const,
      arrayFields: {
        label: { type: "text" as const, contentEditable: true, visible: false },
        body: { type: "richtext" as const, contentEditable: true },
      },
      defaultItemProps: { label: "Tab", body: "<p>Tab content.</p>" },
      getItemSummary: (item: TabItem) => item.label || "Tab",
    },
  },
  defaultProps: {
    heading: "Everything in one workflow",
    align: "left",
    tabs: [
      {
        label: "Develop",
        body: "<p>Branch every change into its own <mark>Multidev</mark> environment.</p><ul><li>No more stepping on each other</li><li>Real URLs to share for review</li><li>Merge when it's ready</li></ul>",
      },
      {
        label: "Test",
        body: "<p>Push to Test with one click and run against <mark>production-like data</mark>.</p><ul><li>Automated visual checks</li><li>Stakeholder sign-off</li><li>Nothing surprises you on Live</li></ul>",
      },
      {
        label: "Launch",
        body: "<p>Deploy to Live in seconds — and roll back just as fast if you need to.</p><blockquote>Confidence to publish on a Friday afternoon.</blockquote>",
      },
    ],
  },
  render: TabsRender,
};
