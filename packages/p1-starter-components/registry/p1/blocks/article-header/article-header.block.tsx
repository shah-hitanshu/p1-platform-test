import type { ComponentConfig } from "@puckeditor/core";
import { ArticleHeaderRender, type ArticleHeaderProps } from "./article-header";
export type { ArticleHeaderProps };

export const ArticleHeaderBlock: ComponentConfig<ArticleHeaderProps> = {
  fields: {
    category: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Category label in 1–3 words. Title case. E.g. Engineering, Product, Community." },
    },
    title: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Article title — compelling and specific, under 15 words." },
    },
    standfirst: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "A 1–2 sentence summary of the article. Plain text, no formatting." },
    },
    authorName: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Author's full name." },
    },
    authorAvatar: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { exclude: true },
    },
    date: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Publication date. Format: Month Day, Year. E.g. April 18, 2026." },
    },
    readTime: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Estimated read time. Format: N min read." },
    },
    align: {
      type: "radio" as const,
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    rule: {
      type: "radio" as const,
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
  },
  defaultProps: {
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
  },
  render: ArticleHeaderRender,
};
