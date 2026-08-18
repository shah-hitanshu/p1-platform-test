import type { Meta, StoryObj } from "@storybook/react";
import { ContainerBlock, type ContainerProps } from "../src/blocks/container";

const ContainerWrapper = (props: ContainerProps) => {
  const Component = ContainerBlock.render as unknown as React.FC<ContainerProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Layout/ContainerBlock",
  component: ContainerWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "select", options: ["none", "light", "white"] },
    pad: { control: "select", options: ["compact", "regular", "spacious"] },
    maxWidth: { control: "select", options: ["narrow", "standard", "wide", "full"] },
    align: { control: "radio", options: ["left", "center"] },
    radius: { control: "select", options: ["none", "soft", "round"] },
  },
} satisfies Meta<typeof ContainerWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const Sample = (() => (
  <div>
    <h2 className="mb-p1-sm text-3xl font-bold tracking-tight text-p1-text">A contained band</h2>
    <p className="leading-relaxed text-p1-text-muted">
      The Container wraps any blocks dropped inside it with a background, padding, and a capped
      content width — useful for boxing a callout, a form, or a short section.
    </p>
  </div>
)) as unknown as ContainerProps["content"];

const empty = [] as unknown as ContainerProps["content"];

export const Light: Story = {
  args: { content: Sample, tone: "light", pad: "regular", maxWidth: "standard", align: "left", radius: "soft" },
};
export const White: Story = {
  args: { content: Sample, tone: "white", pad: "spacious", maxWidth: "narrow", align: "center", radius: "round" },
};
export const Empty: Story = {
  args: { content: empty, tone: "light", pad: "regular", maxWidth: "standard", align: "left", radius: "soft" },
};
