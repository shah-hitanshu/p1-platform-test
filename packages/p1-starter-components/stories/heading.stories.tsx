import type { Meta, StoryObj } from "@storybook/react";
import { HeadingBlock, type HeadingProps } from "@/registry/p1/blocks/heading/heading";

const HeadingWrapper = (props: HeadingProps) => {
  const Component = HeadingBlock.render as React.FC<HeadingProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Content/HeadingBlock",
  component: HeadingWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    level: { control: "select", options: ["H1", "H2", "H3", "H4"] },
    align: { control: "radio", options: ["left", "center"] },
  },
} satisfies Meta<typeof HeadingWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { text: "A heading to anchor the section", level: "H2", align: "left" } };
export const Centered: Story = { args: { text: "A centered headline", level: "H1", align: "center" } };
