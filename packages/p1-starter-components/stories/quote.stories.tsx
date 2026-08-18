import type { Meta, StoryObj } from "@storybook/react";
import { QuoteBlock, type QuoteProps } from "../src/blocks/quote";

const QuoteWrapper = (props: QuoteProps) => {
  const Component = QuoteBlock.render as React.FC<QuoteProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Content/QuoteBlock",
  component: QuoteWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { scale: { control: "radio", options: ["standard", "display"] } },
} satisfies Meta<typeof QuoteWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const quote =
  "Switching over was the easiest call we made all year — <mark>our team ships in hours, not weeks</mark> now.";

export const Standard: Story = { args: { quote, attribution: "Jordan Ellis, Operations Lead", scale: "standard" } };
export const Display: Story = { args: { quote, attribution: "Jordan Ellis, Operations Lead", scale: "display" } };
