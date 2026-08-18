import type { Meta, StoryObj } from "@storybook/react";
import { TeamGridBlock, type TeamGridProps } from "../src/blocks/team-grid";

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
  { name: "Jordan Ellis", role: "Head of Operations", avatar: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=300&q=80", bio: "" },
  { name: "Sam Rivera", role: "Principal Engineer", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&q=80", bio: "" },
  { name: "Priya Nair", role: "Design Lead", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=300&q=80", bio: "" },
];

export const Default: Story = {
  args: { eyebrow: "The team", heading: "People behind the platform.", columns: "3", shape: "circle", tone: "white", members },
};
export const Rounded: Story = {
  args: { eyebrow: "The team", heading: "People behind the platform.", columns: "3", shape: "rounded", tone: "light", members },
};
