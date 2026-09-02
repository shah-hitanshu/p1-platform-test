import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '@/registry/p1/internal/define-meta';
import { ComparisonTableRender, type ComparisonTableProps, type ComparisonRow } from "./comparison-table";
export type { ComparisonTableProps, ComparisonRow };

export const ComparisonTableBlock: ComponentConfig<ComparisonTableProps> = {
  fields: {
    eyebrow: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label above the heading. 1–3 words. Leave blank to omit." },
    },
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Table heading. Under 8 words." },
    },
    subtitle: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "1 sentence below the heading." },
    },
    columns: {
      type: "text" as const,
      ai: { instructions: "Plan names separated by newlines. Max 4. E.g. Starter\nTeam\nEnterprise." },
    },
    featured: {
      type: "select" as const,
      options: [
        { label: "None", value: "none" },
        { label: "Column 1", value: "1" },
        { label: "Column 2", value: "2" },
        { label: "Column 3", value: "3" },
        { label: "Column 4", value: "4" },
      ],
    },
    rows: {
      type: "array",
      arrayFields: {
        feature: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Feature name." },
        },
        c1: { type: "text" as const, ai: { instructions: "Value for column 1. Use yes/no or a short value." } },
        c2: { type: "text" as const, ai: { instructions: "Value for column 2." } },
        c3: { type: "text" as const, ai: { instructions: "Value for column 3." } },
        c4: {
          type: "text" as const,
          ai: { instructions: "Value for column 4. Leave blank if fewer than 4 plans." },
        },
      },
      defaultItemProps: { feature: "Feature", c1: "yes", c2: "yes", c3: "yes", c4: "" },
      getItemSummary: (item: ComparisonRow) => item.feature || "Feature",
    },
  },
  defaultProps: {
    eyebrow: "Compare",
    heading: "Find the plan that fits.",
    subtitle: "Every plan includes the core WebOps workflow.",
    columns: "Starter\nTeam\nEnterprise",
    featured: "2",
    rows: [
      { feature: "Projects", c1: "1", c2: "10", c3: "Unlimited", c4: "" },
      { feature: "Multidev environments", c1: "no", c2: "yes", c3: "yes", c4: "" },
      { feature: "Role-based access", c1: "no", c2: "yes", c3: "yes", c4: "" },
      { feature: "SSO & audit logs", c1: "no", c2: "no", c3: "yes", c4: "" },
      { feature: "Support", c1: "Community", c2: "Priority", c3: "Dedicated CSM", c4: "" },
    ],
  },
  render: ComparisonTableRender,
};

export const meta = defineMeta({
  title: 'Comparison Table',
  description: 'Feature comparison table with up to 4 named columns and checkmark/text rows; use for pricing or product capability comparisons.',
  categories: ["convert"],
  published: true,
  registryDependencies: ["@p1/tokens","@p1/internal-icons"],
});
