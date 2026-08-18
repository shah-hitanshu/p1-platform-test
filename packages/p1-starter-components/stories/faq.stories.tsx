import type { Meta, StoryObj } from "@storybook/react";
import { FaqBlock, type FaqProps } from "../src/blocks/faq";

const FaqWrapper = (props: FaqProps) => {
  const Component = FaqBlock.render as React.FC<FaqProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Convert/FaqBlock",
  component: FaqWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
} satisfies Meta<typeof FaqWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    heading: "Frequently asked questions",
    items: [
      { q: "Do I need a developer to make changes?", a: "No. Anyone on your team can edit pages visually with ready-made blocks — no code required." },
      { q: "Can I use my own components?", a: "Yes. Developers can add custom blocks once, and the whole team can reuse them." },
      { q: "How do previews work?", a: "Every change gets a shareable preview link, so you can review before publishing." },
    ],
  },
};
