import type { Meta, StoryObj } from "@storybook/react";
import { FeatureMediaBlock, type FeatureMediaProps } from "@/registry/p1/blocks/feature-media/feature-media";

const FeatureMediaWrapper = (props: FeatureMediaProps) => {
  const Component = FeatureMediaBlock.render as React.FC<FeatureMediaProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Value/FeatureMediaBlock",
  component: FeatureMediaWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    mediaSide: { control: "radio", options: ["right", "left"] },
    tone: { control: "select", options: ["white", "light", "dark"] },
  },
} satisfies Meta<typeof FeatureMediaWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: FeatureMediaProps = {
  eyebrow: "How it works",
  title: "Designed around the way you work.",
  body: "Move from idea to published in a few clicks. Preview every change, then make it live whenever you’re ready.",
  bullets: [
    { text: "Visual, on-brand editing" },
    { text: "Preview before you publish" },
    { text: "Publish in one click" },
  ],
  buttonLabel: "See how it works →",
  imageSrc: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=1000&q=80",
  mediaSide: "right",
  tone: "white",
};

export const MediaRight: Story = { args: { ...base } };
export const MediaLeftDark: Story = { args: { ...base, mediaSide: "left", tone: "dark" } };
