import type { Meta, StoryObj } from "@storybook/react";
import { RichTextBlock, type RichTextProps } from "@/registry/p1/blocks/rich-text/rich-text.block";

const RichTextWrapper = (props: RichTextProps) => {
  const Component = RichTextBlock.render as React.FC<RichTextProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Editorial/RichTextBlock",
  component: RichTextWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    measure: { control: "select", options: ["narrow", "standard", "wide"] },
    size: { control: "radio", options: ["regular", "large"] },
    dropCap: { control: "radio", options: ["off", "on"] },
  },
} satisfies Meta<typeof RichTextWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const content =
  "<p>A year ago, shipping a change meant a ticket, a queue, and a wait. Today it takes minutes — and the difference wasn't a single tool.</p>" +
  "<h2>It started with previews</h2>" +
  "<p>Every change got a shareable link before it went live. Reviewers stopped guessing and <mark>started seeing</mark>.</p>" +
  "<ul><li>Fewer round-trips between teams</li><li>Marketers unblocked from engineering</li><li>Confidence to publish on a Friday</li></ul>" +
  "<h3>The habit that stuck</h3>" +
  "<p>We made \"preview first\" the default, not the exception. Small change, large compounding effect.</p>" +
  "<blockquote>The best workflow is the one your whole team actually uses.</blockquote>";

export const Default: Story = {
  args: { content, measure: "standard", size: "regular", dropCap: "off" },
};
export const WithDropCap: Story = {
  args: { content, measure: "standard", size: "large", dropCap: "on" },
};
