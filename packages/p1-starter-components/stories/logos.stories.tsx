import type { Meta, StoryObj } from "@storybook/react";
import { LogoCloudBlock, type LogoCloudProps } from "../src/blocks/logos";

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
    heading: "Featured in",
    style: "mono",
    height: "medium",
    logos: [
      { src: "", label: "NPR" },
      { src: "", label: "PBS" },
      { src: "", label: "REUTERS" },
      { src: "", label: "NATURE" },
    ],
  },
};
