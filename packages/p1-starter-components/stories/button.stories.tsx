import type { Meta, StoryObj } from "@storybook/react";
import { ButtonBlock, type ButtonProps } from "../src/blocks/button";

const ButtonWrapper = (props: ButtonProps) => {
  const Component = ButtonBlock.render as React.FC<ButtonProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Content/ButtonBlock",
  component: ButtonWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["primary", "secondary", "yellow", "purple"] },
    align: { control: "radio", options: ["left", "center"] },
  },
} satisfies Meta<typeof ButtonWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { label: "Get started", href: "#", variant: "primary", align: "left" } };
export const Yellow: Story = { args: { label: "Start free trial", href: "#", variant: "yellow", align: "center" } };
