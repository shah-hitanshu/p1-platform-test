import type { Meta, StoryObj } from "@storybook/react";
import { AnnouncementBlock, type AnnouncementProps } from "@/registry/p1/blocks/announcement/announcement.block";

const AnnouncementWrapper = (props: AnnouncementProps) => {
  const Component = AnnouncementBlock.render as React.FC<AnnouncementProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Attention/AnnouncementBlock",
  component: AnnouncementWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "select", options: ["accent", "yellow", "dark", "gradient"] },
    align: { control: "radio", options: ["center", "left"] },
  },
} satisfies Meta<typeof AnnouncementWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: AnnouncementProps = {
  text: "Something new just launched — take a look.",
  linkLabel: "Read the announcement →",
  tone: "accent",
  align: "center",
};

export const Accent: Story = { args: { ...base } };
export const Gradient: Story = { args: { ...base, tone: "gradient" } };
