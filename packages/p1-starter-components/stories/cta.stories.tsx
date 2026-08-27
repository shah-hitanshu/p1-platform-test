import type { Meta, StoryObj } from "@storybook/react";
import { CtaBannerBlock, type CtaBannerProps } from "@/registry/p1/blocks/cta/cta.block";

const CtaBannerWrapper = (props: CtaBannerProps) => {
  const Component = CtaBannerBlock.render as React.FC<CtaBannerProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Convert/CtaBannerBlock",
  component: CtaBannerWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    layout: { control: "select", options: ["centered", "split"] },
    align: { control: "radio", options: ["left", "center"] },
    tone: { control: "select", options: ["yellow", "accent", "dark", "light", "gradient", "outline"] },
    decoration: { control: "select", options: ["none", "glow", "dots"] },
    corners: { control: "select", options: ["square", "soft", "round"] },
    padding: { control: "select", options: ["compact", "regular", "spacious"] },
  },
} satisfies Meta<typeof CtaBannerWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: CtaBannerProps = {
  eyebrow: "",
  title: "Ready to ship faster?",
  subtitle: "Start a free trial — no credit card, no deploy pipeline to wrangle.",
  buttonLabel: "Start free trial",
  secondaryLabel: "",
  layout: "centered",
  align: "center",
  tone: "yellow",
  decoration: "none",
  corners: "round",
  padding: "regular",
};

export const Yellow: Story = { args: { ...base } };
export const Gradient: Story = { args: { ...base, tone: "gradient", decoration: "glow", secondaryLabel: "Talk to sales" } };
export const Split: Story = { args: { ...base, tone: "dark", layout: "split", align: "left" } };
