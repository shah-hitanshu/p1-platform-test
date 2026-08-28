import type { Meta, StoryObj } from "@storybook/react";
import { TeamGridBlock, type TeamGridProps } from "@/registry/p1/blocks/team-grid/team-grid.block";
import { wireframe } from '@/registry/p1/blocks/define-meta';

const TeamGridWrapper = (props: TeamGridProps) => {
  const Component = TeamGridBlock.render as React.FC<TeamGridProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Trust/TeamGridBlock",
  component: TeamGridWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    columns: { control: "select", options: ["2", "3", "4"] },
    shape: { control: "radio", options: ["circle", "rounded"] },
    tone: { control: "radio", options: ["white", "light"] },
  },
} satisfies Meta<typeof TeamGridWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const members = [
  { name: "Jordan Ellis", role: "Head of Operations", avatar: wireframe(300, 300), bio: "" },
  { name: "Sam Rivera", role: "Principal Engineer", avatar: wireframe(300, 300), bio: "" },
  { name: "Priya Nair", role: "Design Lead", avatar: wireframe(300, 300), bio: "" },
];

export const Default: Story = {
  args: { eyebrow: "The team", heading: "People behind the platform.", columns: "3", shape: "circle", tone: "white", members },
};
export const Rounded: Story = {
  args: { eyebrow: "The team", heading: "People behind the platform.", columns: "3", shape: "rounded", tone: "light", members },
};
