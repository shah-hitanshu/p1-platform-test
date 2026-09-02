import type { Meta, StoryObj } from "@storybook/react";
import { ImageBlock, type ImageProps } from "@/registry/p1/blocks/image/image.block";

const ImageWrapper = (props: ImageProps) => {
  const Component = ImageBlock.render as React.FC<ImageProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Showcase/ImageBlock",
  component: ImageWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    width: { control: "radio", options: ["contained", "full bleed"] },
    ratio: { control: "select", options: ["16 / 9", "4 / 3", "1 / 1", "3 / 2", "21 / 9"] },
    fit: { control: "select", options: ["cover", "contain", "fill"] },
    position: { control: "select", options: ["center", "top", "bottom", "left", "right"] },
    radius: { control: "select", options: ["none", "soft", "round"] },
    treatment: { control: "radio", options: ["color", "b&w"] },
  },
} satisfies Meta<typeof ImageWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: ImageProps = {
  src: "https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=1100&q=80",
  alt: "Editorial photograph",
  width: "contained",
  ratio: "16 / 9",
  fit: "cover",
  position: "center",
  radius: "soft",
  treatment: "color",
};

export const Default: Story = { args: { ...base } };
export const BlackAndWhite: Story = { args: { ...base, treatment: "b&w", ratio: "3 / 2" } };
