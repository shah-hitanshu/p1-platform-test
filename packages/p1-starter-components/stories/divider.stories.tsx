import type { Meta, StoryObj } from "@storybook/react";
import { DividerBlock, type DividerProps } from "@/registry/p1/blocks/divider/divider.block";

const DividerWrapper = (props: DividerProps) => {
  const Component = DividerBlock.render as React.FC<DividerProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Content/DividerBlock",
  component: DividerWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    style: { control: "select", options: ["solid", "dashed", "dots"] },
    spacing: { control: "select", options: ["small", "medium", "large"] },
  },
} satisfies Meta<typeof DividerWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Solid: Story = { args: { style: "solid", spacing: "medium" } };
export const Dots: Story = { args: { style: "dots", spacing: "medium" } };
