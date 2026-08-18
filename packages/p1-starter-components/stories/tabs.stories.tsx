import type { Meta, StoryObj } from "@storybook/react";
import { TabsBlock, type TabsProps } from "../src/blocks/tabs";

const TabsWrapper = (props: TabsProps) => {
  const Component = TabsBlock.render as React.FC<TabsProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Layout/TabsBlock",
  component: TabsWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { align: { control: "radio", options: ["left", "center"] } },
} satisfies Meta<typeof TabsWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    heading: "Everything in one workflow",
    align: "left",
    tabs: [
      {
        label: "Develop",
        body: "<p>Branch every change into its own <mark>Multidev</mark> environment.</p><ul><li>No more stepping on each other</li><li>Real URLs to share for review</li><li>Merge when it's ready</li></ul>",
      },
      {
        label: "Test",
        body: "<p>Push to Test with one click and run against <mark>production-like data</mark>.</p><ul><li>Automated visual checks</li><li>Stakeholder sign-off</li><li>Nothing surprises you on Live</li></ul>",
      },
      {
        label: "Launch",
        body: "<p>Deploy to Live in seconds — and roll back just as fast if you need to.</p><blockquote>Confidence to publish on a Friday afternoon.</blockquote>",
      },
    ],
  },
};

export const Centered: Story = {
  args: { ...(Default.args as TabsProps), align: "center" },
};
