import type { Meta, StoryObj } from "@storybook/react";
import { SpacerBlock, type SpacerProps } from "@/registry/p1/blocks/spacer/spacer.block";

const SpacerWrapper = (props: SpacerProps) => {
  const Component = SpacerBlock.render as React.FC<SpacerProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Content/SpacerBlock",
  component: SpacerWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { size: { control: "select", options: ["xs", "sm", "md", "lg", "xl"] } },
} satisfies Meta<typeof SpacerWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = { args: { size: "md" } };
export const XLarge: Story = { args: { size: "xl" } };
