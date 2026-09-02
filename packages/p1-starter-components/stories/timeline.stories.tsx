import type { Meta, StoryObj } from "@storybook/react";
import { TimelineBlock, type TimelineProps } from "@/registry/p1/blocks/timeline/timeline";

const TimelineWrapper = (props: TimelineProps) => {
  const Component = TimelineBlock.render as React.FC<TimelineProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Value/TimelineBlock",
  component: TimelineWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    layout: { control: "select", options: ["vertical", "alternating"] },
    tone: { control: "radio", options: ["white", "light"] },
  },
} satisfies Meta<typeof TimelineWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { date: "2019", title: "The first commit", body: "Two engineers, one repo, and a stubborn belief that shipping should be simple." },
  { date: "2021", title: "Multidev arrives", body: "Parallel environments for every branch — review without stepping on each other." },
  { date: "2023", title: "100,000 sites", body: "Teams across publishing, higher ed, and government make the switch." },
  { date: "2026", title: "One workflow for everyone", body: "Developers, marketers, and IT finally share a single way to build and run the web." },
];

export const Vertical: Story = {
  args: { eyebrow: "Our story", heading: "How we got here.", layout: "vertical", tone: "white", items },
};
export const Alternating: Story = {
  args: { eyebrow: "Our story", heading: "How we got here.", layout: "alternating", tone: "light", items },
};
