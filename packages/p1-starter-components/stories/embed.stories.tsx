import type { Meta, StoryObj } from "@storybook/react";
import { EmbedBlock, type EmbedProps } from "@/registry/p1/blocks/embed/embed";

const EmbedWrapper = (props: EmbedProps) => {
  const Component = EmbedBlock.render as React.FC<EmbedProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Editorial/EmbedBlock",
  component: EmbedWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    kind: { control: "select", options: ["video", "social", "map", "generic"] },
    ratio: { control: "select", options: ["16 / 9", "4 / 3", "1 / 1"] },
    width: { control: "select", options: ["contained", "wide"] },
  },
} satisfies Meta<typeof EmbedWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Video: Story = {
  args: {
    kind: "video",
    url: "https://youtube.com/watch?v=demo",
    title: "Inside a Pantheon deploy — start to Live in 90 seconds",
    ratio: "16 / 9",
    caption: "",
    width: "wide",
  },
};
export const Map: Story = {
  args: {
    kind: "map",
    url: "https://google.com/maps",
    title: "",
    ratio: "16 / 9",
    caption: "Our office — San Francisco, CA",
    width: "contained",
  },
};
export const Social: Story = {
  args: {
    kind: "social",
    url: "https://x.com/getpantheon",
    title: "",
    ratio: "4 / 3",
    caption: "",
    width: "contained",
  },
};
