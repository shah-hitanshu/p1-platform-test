import type { Meta, StoryObj } from "@storybook/react";
import { StatsBlock, type StatsProps } from "@/registry/p1/blocks/stats/stats";

const StatsWrapper = (props: StatsProps) => {
  const Component = StatsBlock.render as React.FC<StatsProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Trust/StatsBlock",
  component: StatsWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { tone: { control: "radio", options: ["light", "dark"] } },
} satisfies Meta<typeof StatsWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { value: "10k+", label: "Teams onboarded" },
  { value: "99.9%", label: "Uptime" },
  { value: "2M+", label: "Pages published" },
  { value: "4.9/5", label: "Customer rating" },
];

export const Light: Story = { args: { tone: "light", items } };
export const Dark: Story = { args: { tone: "dark", items } };
