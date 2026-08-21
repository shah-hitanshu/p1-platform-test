import type { Meta, StoryObj } from "@storybook/react";
import { ParagraphBlock, type ParagraphProps } from "@/registry/p1/blocks/paragraph/paragraph.block";

const ParagraphWrapper = (props: ParagraphProps) => {
  const Component = ParagraphBlock.render as React.FC<ParagraphProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Content/ParagraphBlock",
  component: ParagraphWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    style: { control: "radio", options: ["body", "lead"] },
    size: { control: "select", options: ["small", "regular", "large"] },
    align: { control: "radio", options: ["left", "center"] },
  },
} satisfies Meta<typeof ParagraphWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const text =
  "This is a paragraph. Use it to expand on the heading above with a sentence or two of supporting detail — keep it clear, specific, and easy to scan.";

export const Body: Story = { args: { text, style: "body", size: "regular", align: "left" } };
export const Lead: Story = { args: { text, style: "lead", size: "large", align: "left" } };
