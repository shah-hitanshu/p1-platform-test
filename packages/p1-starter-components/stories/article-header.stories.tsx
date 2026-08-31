import type { Meta, StoryObj } from "@storybook/react";
import { ArticleHeaderBlock, type ArticleHeaderProps } from "@/registry/p1/blocks/article-header/article-header.block";
import { wireframe } from '@/registry/p1/internal/define-meta';

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
  authorAvatar: wireframe(200, 200),
  date: "April 18, 2026",
  readTime: "6 min read",
  align: "left",
  rule: "on",
};

export const Default: Story = { args: { ...base } };
export const Centered: Story = { args: { ...base, align: "center" } };
