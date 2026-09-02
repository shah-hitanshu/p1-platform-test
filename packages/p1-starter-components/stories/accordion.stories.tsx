import type { Meta, StoryObj } from "@storybook/react";
import { AccordionBlock, type AccordionProps } from "@/registry/p1/blocks/accordion/accordion.block";

const AccordionWrapper = (props: AccordionProps) => {
  const Component = AccordionBlock.render as React.FC<AccordionProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Layout/AccordionBlock",
  component: AccordionWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { align: { control: "radio", options: ["left", "center"] } },
} satisfies Meta<typeof AccordionWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    heading: "The details",
    align: "left",
    items: [
      {
        title: "What frameworks are supported?",
        body: "<p>WordPress, Drupal, and Next.js — all on the same platform, with the same <mark>Dev-Test-Live</mark> workflow.</p>",
      },
      {
        title: "How do environments work?",
        body: "<p>Every site gets Dev, Test, and Live — plus unlimited Multidev branches for parallel work.</p><ul><li>Isolated by default</li><li>Shareable preview URLs</li><li>One-click promotion</li></ul>",
      },
      {
        title: "Can the whole team use it?",
        body: "<p>Yes. Developers, marketers, and IT share one workflow with role-based access — no one waits on anyone else.</p>",
      },
    ],
  },
};
