import type { Meta, StoryObj } from "@storybook/react";
import { HeroBlock, type HeroProps } from "@/registry/p1/blocks/hero/hero";

const HeroWrapper = (props: HeroProps) => {
  const Component = HeroBlock.render as React.FC<HeroProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Attention/HeroBlock",
  component: HeroWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "select", options: ["indigo", "purple", "dark", "light"] },
    layout: { control: "select", options: ["split", "full image", "text only"] },
    imageSide: { control: "radio", options: ["right", "left"] },
    imageFill: { control: "radio", options: ["card", "flush"] },
    splitRatio: { control: "select", options: ["even", "copy-wide", "image-wide"] },
    align: { control: "select", options: ["left", "center", "right"] },
    overlay: { control: "select", options: ["none", "scrim", "gradient down", "gradient right"] },
    overlayStrength: { control: "select", options: ["light", "medium", "heavy"] },
    knockout: { control: "radio", options: ["off", "on"] },
  },
} satisfies Meta<typeof HeroWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: HeroProps = {
  eyebrow: "New — now available",
  title: "Your big idea, beautifully online.",
  description:
    "A flexible starting point for your next page. Swap in your own headline, story, and imagery — this layout adapts to whatever you publish.",
  primaryLabel: "Start free trial",
  secondaryLabel: "Book a demo →",
  tone: "indigo",
  layout: "split",
  imageSrc: "https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1200&q=80",
  imageSide: "right",
  imageFill: "card",
  splitRatio: "even",
  align: "left",
  overlay: "gradient right",
  overlayStrength: "medium",
  knockout: "off",
};

export const Split: Story = { args: { ...base } };
export const FullImage: Story = { args: { ...base, layout: "full image" } };
export const TextOnly: Story = { args: { ...base, layout: "text only", tone: "light", align: "center" } };
export const FlushSplit: Story = { args: { ...base, imageFill: "flush", splitRatio: "copy-wide" } };
