import type { Meta, StoryObj } from "@storybook/react";
import { ArticleHeaderBlock, type ArticleHeaderProps } from "../src/blocks/article-header";

const ArticleHeaderWrapper = (props: ArticleHeaderProps) => {
  const Component = ArticleHeaderBlock.render as React.FC<ArticleHeaderProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Editorial/ArticleHeaderBlock",
  component: ArticleHeaderWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    align: { control: "radio", options: ["left", "center"] },
    rule: { control: "radio", options: ["on", "off"] },
  },
} satisfies Meta<typeof ArticleHeaderWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: ArticleHeaderProps = {
  category: "Engineering",
  title: "What a year of shipping on Multidev taught us about flow.",
  standfirst:
    "A behind-the-scenes look at how the team moved from weeks to hours — and the small habits that made the difference.",
  authorName: "Jordan Ellis",
  authorAvatar: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&q=80",
  date: "April 18, 2026",
  readTime: "6 min read",
  align: "left",
  rule: "on",
};

export const Default: Story = { args: { ...base } };
export const Centered: Story = { args: { ...base, align: "center" } };
