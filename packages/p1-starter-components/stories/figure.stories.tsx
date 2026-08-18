import type { Meta, StoryObj } from "@storybook/react";
import { FigureBlock, type FigureProps } from "../src/blocks/figure";

const FigureWrapper = (props: FigureProps) => {
  const Component = FigureBlock.render as React.FC<FigureProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Editorial/FigureBlock",
  component: FigureWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    ratio: { control: "select", options: ["16 / 9", "3 / 2", "4 / 3", "1 / 1", "21 / 9"] },
    width: { control: "select", options: ["contained", "wide", "full bleed"] },
    radius: { control: "select", options: ["none", "soft", "round"] },
    treatment: { control: "radio", options: ["color", "b&w"] },
  },
} satisfies Meta<typeof FigureWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: FigureProps = {
  src: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1300&q=80",
  alt: "The team reviewing a preview together",
  caption: "The team reviews a preview link before anything reaches Live.",
  credit: "Photo — Pantheon",
  ratio: "3 / 2",
  width: "wide",
  radius: "soft",
  treatment: "color",
};

export const Default: Story = { args: { ...base } };
export const Contained: Story = { args: { ...base, width: "contained", ratio: "4 / 3" } };
export const BlackAndWhite: Story = { args: { ...base, treatment: "b&w" } };
