import type { Meta, StoryObj } from "@storybook/react";
import { StepsBlock, type StepsProps } from "@/registry/p1/blocks/steps/steps";

const StepsWrapper = (props: StepsProps) => {
  const Component = StepsBlock.render as React.FC<StepsProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Value/StepsBlock",
  component: StepsWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { tone: { control: "select", options: ["white", "light", "dark"] } },
} satisfies Meta<typeof StepsWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { title: "Plan", body: "Start from a template or a blank page and outline what you want to say." },
  { title: "Build", body: "Compose your page from ready-made blocks — no code required." },
  { title: "Publish", body: "Preview your changes, then make them live in a single click." },
];

export const Light: Story = { args: { eyebrow: "How it works", heading: "Ship in three steps.", items, tone: "light" } };
export const Dark: Story = { args: { eyebrow: "How it works", heading: "Ship in three steps.", items, tone: "dark" } };
