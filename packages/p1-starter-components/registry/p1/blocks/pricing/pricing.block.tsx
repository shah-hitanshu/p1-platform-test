import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '../define-meta';
import { PricingRender, type PricingProps, type PricingTier } from "./pricing";
export type { PricingProps, PricingTier };

export const PricingBlock: ComponentConfig<PricingProps> = {
  fields: {
    eyebrow: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label above the heading. 1–3 words. E.g. Pricing." },
    },
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Section heading. Value-focused, under 10 words." },
    },
    subtitle: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "1–2 sentence reassurance below the heading. E.g. start free." },
    },
    tiers: {
      type: "array" as const,
      arrayFields: {
        name: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Plan name. 1–2 words. E.g. Starter, Team, Enterprise." },
        },
        price: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Displayed price. E.g. $49 or Custom." },
        },
        period: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Billing period. E.g. /mo or leave blank." },
        },
        features: {
          type: "textarea" as const,
          ai: { instructions: "One feature per line. Plain text. 3–6 lines." },
        },
        buttonLabel: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "CTA label. 2–4 words. E.g. Start free trial." },
        },
        featured: {
          type: "radio" as const,
          options: [
            { label: "Off", value: "off" },
            { label: "On", value: "on" },
          ],
        },
      },
      defaultItemProps: { name: "Plan", price: "$0", period: "/mo", features: "Feature one\nFeature two", buttonLabel: "Choose plan", featured: "off" },
      getItemSummary: (item: PricingTier) => item.name || "Tier",
    },
  },
  defaultProps: {
    eyebrow: "Pricing",
    heading: "Plans that scale with your portfolio.",
    subtitle: "Start free. Upgrade when your team is ready.",
    tiers: [
      { name: "Starter", price: "$0", period: "/mo", features: "1 project\nCore features\nCommunity support", buttonLabel: "Start free", featured: "off" },
      { name: "Team", price: "$49", period: "/mo", features: "Up to 10 projects\nAdvanced features\nRole-based access\nPriority support", buttonLabel: "Start free trial", featured: "on" },
      { name: "Enterprise", price: "Custom", period: "", features: "Unlimited sites\nBulk updates\nSSO & audit logs\nDedicated CSM", buttonLabel: "Contact sales", featured: "off" },
    ],
  },
  render: PricingRender,
};

export const meta = defineMeta({
  title: 'Pricing',
  description: 'Pricing tier cards with name, price, period, feature list, and CTA button, supporting a featured/highlighted tier; use for pricing pages.',
  categories: ["convert"],
  registryDependencies: ["@p1/tokens","@p1/internal-btn","@p1/internal-icons"],
});
