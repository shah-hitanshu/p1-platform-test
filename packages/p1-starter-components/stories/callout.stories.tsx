import type { Meta, StoryObj } from "@storybook/react";
import { CalloutBlock, type CalloutProps } from "@/registry/p1/blocks/callout/callout.block";

const CalloutWrapper = (props: CalloutProps) => {
  const Component = CalloutBlock.render as React.FC<CalloutProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Editorial/CalloutBlock",
  component: CalloutWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["note", "info", "tip", "warning"] },
  },
} satisfies Meta<typeof CalloutWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tip: Story = {
  args: {
    variant: "tip",
    title: "Try this",
    body: "Make “preview first” the default. Share the link before you publish — reviewers stop guessing and start seeing.",
  },
};
export const Info: Story = {
  args: {
    variant: "info",
    title: "Good to know",
    body: "Every environment gets its own shareable URL, so stakeholders can review without a login.",
  },
};
export const Warning: Story = {
  args: {
    variant: "warning",
    title: "Heads up",
    body: "Deploying to Live is instant — but you can roll back just as fast if something looks off.",
  },
};
export const Note: Story = {
  args: {
    variant: "note",
    title: "Note",
    body: "These blocks render statically here; wire them to your data source in production.",
  },
};
