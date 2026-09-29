import type { Meta, StoryObj } from "@storybook/react";
import { P1_LOGO } from "@/registry/p1/internal/assets";
import { LogoCloudBlock, type LogoCloudProps } from "@/registry/p1/blocks/logos/logos.block";

const LogoCloudWrapper = (props: LogoCloudProps) => {
  const Component = LogoCloudBlock.render as React.FC<LogoCloudProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Trust/LogoCloudBlock",
  component: LogoCloudWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    style: { control: "radio", options: ["mono", "color"] },
    height: { control: "select", options: ["small", "medium", "large"] },
  },
} satisfies Meta<typeof LogoCloudWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    heading: "Trusted by teams like",
    style: "mono",
    height: "medium",
    logos: [
      { src: P1_LOGO, label: "Company 1" },
      { src: P1_LOGO, label: "Company 2" },
      { src: P1_LOGO, label: "Company 3" },
      { src: P1_LOGO, label: "Company 4" },
    ],
  },
};
