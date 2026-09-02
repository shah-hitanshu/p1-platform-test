import type { Meta, StoryObj } from "@storybook/react";
import { LeadCaptureBlock, type LeadCaptureProps } from "@/registry/p1/blocks/lead-capture/lead-capture";

const LeadCaptureWrapper = (props: LeadCaptureProps) => {
  const Component = LeadCaptureBlock.render as React.FC<LeadCaptureProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Convert/LeadCaptureBlock",
  component: LeadCaptureWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "select", options: ["light", "purple", "dark", "yellow"] },
    layout: { control: "radio", options: ["inline", "stacked"] },
  },
} satisfies Meta<typeof LeadCaptureWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: LeadCaptureProps = {
  heading: "Stay in the loop.",
  subtitle: "Occasional updates, straight to your inbox.",
  placeholder: "you@company.com",
  buttonLabel: "Subscribe",
  note: "No spam. Unsubscribe anytime.",
  tone: "purple",
  layout: "inline",
};

export const Purple: Story = { args: { ...base } };
export const LightStacked: Story = { args: { ...base, tone: "light", layout: "stacked" } };
