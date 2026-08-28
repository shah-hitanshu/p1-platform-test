import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '../define-meta';
import { StatsRender, type StatsProps, type StatItem } from "./stats";
export type { StatsProps, StatItem };

export const StatsBlock: ComponentConfig<StatsProps> = {
  fields: {
    tone: {
      type: "radio" as const,
      options: [
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ],
    },
    items: {
      type: "array" as const,
      arrayFields: {
        value: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "The statistic value. E.g. 99.9% or 10k+." },
        },
        label: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Short label below the value. 2–4 words." },
        },
      },
      defaultItemProps: { value: "100%", label: "Metric" },
      getItemSummary: (item: StatItem) => item.value || "Stat",
    },
  },
  defaultProps: {
    tone: "light",
    items: [
      { value: "10k+", label: "Teams onboarded" },
      { value: "99.9%", label: "Uptime" },
      { value: "2M+", label: "Pages published" },
      { value: "4.9/5", label: "Customer rating" },
    ],
  },
  render: StatsRender,
};

export const meta = defineMeta({
  title: 'Stats',
  description: 'Horizontal grid of large value+label stat items in light or dark tone; use for key metrics or social-proof numbers.',
  categories: ["trust"],
  published: true,
});
