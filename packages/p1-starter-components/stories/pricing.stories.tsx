import type { Meta, StoryObj } from "@storybook/react";
import { PricingBlock, type PricingProps } from "@/registry/p1/blocks/pricing/pricing.block";

const PricingWrapper = (props: PricingProps) => {
  const Component = PricingBlock.render as React.FC<PricingProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Convert/PricingBlock",
  component: PricingWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
} satisfies Meta<typeof PricingWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    eyebrow: "Pricing",
    heading: "Plans that scale with your portfolio.",
    subtitle: "Start free. Upgrade when your team is ready.",
    tiers: [
      { name: "Starter", price: "$0", period: "/mo", features: "1 project\nCore features\nCommunity support", buttonLabel: "Start free", featured: "off" },
      { name: "Team", price: "$49", period: "/mo", features: "Up to 10 projects\nAdvanced features\nRole-based access\nPriority support", buttonLabel: "Start free trial", featured: "on" },
      { name: "Enterprise", price: "Custom", period: "", features: "Unlimited sites\nBulk updates\nSSO & audit logs\nDedicated CSM", buttonLabel: "Contact sales", featured: "off" },
    ],
  },
};
