import type { Meta, StoryObj } from "@storybook/react";
import { PullQuoteBlock, type PullQuoteProps } from "../src/blocks/pull-quote";

const PullQuoteWrapper = (props: PullQuoteProps) => {
  const Component = PullQuoteBlock.render as React.FC<PullQuoteProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Editorial/PullQuoteBlock",
  component: PullQuoteWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    accent: { control: "select", options: ["yellow rule", "quote mark", "none"] },
    align: { control: "radio", options: ["center", "left"] },
  },
} satisfies Meta<typeof PullQuoteWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: PullQuoteProps = {
  quote:
    "The best workflow is the one your whole team <mark>actually uses</mark> — not the one that looks impressive in a diagram.",
  cite: "Jordan Ellis, Operations Lead",
  accent: "yellow rule",
  align: "center",
};

export const Default: Story = { args: { ...base } };
export const QuoteMark: Story = { args: { ...base, accent: "quote mark" } };
export const Left: Story = { args: { ...base, align: "left", accent: "none" } };
