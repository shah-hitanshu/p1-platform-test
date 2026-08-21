import type { Meta, StoryObj } from "@storybook/react";
import { ListBlock, type ListProps } from "@/registry/p1/blocks/list/list";

const ListWrapper = (props: ListProps) => {
  const Component = ListBlock.render as React.FC<ListProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Content/ListBlock",
  component: ListWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { style: { control: "select", options: ["check", "bullet", "numbered"] } },
} satisfies Meta<typeof ListWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { text: "Fast, reliable performance" },
  { text: "Simple, visual editing" },
  { text: "Works across your whole team" },
  { text: "Secure by default" },
];

export const Check: Story = { args: { style: "check", items } };
export const Bullet: Story = { args: { style: "bullet", items } };
export const Numbered: Story = { args: { style: "numbered", items } };
