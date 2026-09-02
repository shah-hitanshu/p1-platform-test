import type { Meta, StoryObj } from "@storybook/react";
import { FeatureCardsBlock, type FeatureCardsProps } from "@/registry/p1/blocks/features/features";

const FeatureCardsWrapper = (props: FeatureCardsProps) => {
  const Component = FeatureCardsBlock.render as React.FC<FeatureCardsProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Value/FeatureCardsBlock",
  component: FeatureCardsWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    columns: { control: "select", options: ["2", "3", "4"] },
    colorScheme: { control: "select", options: ["brand mix", "light", "purple", "dark", "outline"] },
    corners: { control: "select", options: ["sharp", "soft", "round"] },
    depth: { control: "select", options: ["flat", "subtle", "raised"] },
    cardAlign: { control: "radio", options: ["left", "center"] },
    sectionBg: { control: "select", options: ["light", "white", "dark", "none"] },
  },
} satisfies Meta<typeof FeatureCardsWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const cards = [
  { eyebrow: "Simple", title: "Easy to use", body: "A visual editor anyone on your team can pick up in minutes — no training required." },
  { eyebrow: "Flexible", title: "Built to scale", body: "Start with one page and grow to hundreds — everything stays consistent as you go." },
  { eyebrow: "Reliable", title: "Always on", body: "Fast, secure, and dependable — so you can focus on your content, not your infrastructure." },
];

const base: FeatureCardsProps = {
  subtitle: "Why teams choose us",
  heading: "Everything you need, in one place.",
  cards,
  columns: "3",
  colorScheme: "brand mix",
  corners: "round",
  depth: "flat",
  cardAlign: "left",
  sectionBg: "light",
};

export const BrandMix: Story = { args: { ...base } };
export const Outline: Story = { args: { ...base, colorScheme: "outline", sectionBg: "white", depth: "subtle" } };
