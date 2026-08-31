import type { Meta, StoryObj } from "@storybook/react";
import { CardGridBlock, type CardGridProps } from "@/registry/p1/blocks/card-grid/card-grid.block";
import { wireframe } from '@/registry/p1/internal/define-meta';

const CardGridWrapper = (props: CardGridProps) => {
  const Component = CardGridBlock.render as React.FC<CardGridProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Showcase/CardGridBlock",
  component: CardGridWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { columns: { control: "select", options: ["2", "3", "4"] } },
} satisfies Meta<typeof CardGridWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    heading: "Customer stories",
    columns: "3",
    items: [
      { title: "Northwind", subtitle: "Retail · 38% faster launches", imageUrl: wireframe(600, 400) },
      { title: "Atlas Media", subtitle: "Publishing · 2M monthly reads", imageUrl: wireframe(600, 400) },
      { title: "Brightline", subtitle: "SaaS · 4.9/5 satisfaction", imageUrl: wireframe(600, 400) },
    ],
  },
};
