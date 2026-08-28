import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '../define-meta';
import { List, type ListProps } from "./list";
export type { ListProps };

export const ListBlock: ComponentConfig<ListProps> = {
  fields: {
    items: {
      type: "array",
      arrayFields: {
        text: {
          type: "text" as const,
          ai: {
            instructions:
              "A single concise list item. Plain text, sentence case, no trailing punctuation except for complete sentences.",
          },
        },
      },
      defaultItemProps: {
        text: "A clear, scannable list item",
      },
    },
    style: {
      type: "radio" as const,
      options: [
        { label: "Bullet", value: "bullet" },
        { label: "Numbered", value: "numbered" },
        { label: "Check", value: "check" },
      ],
    },
  },
  defaultProps: {
    items: [
      { text: "First item that gets the reader's attention" },
      { text: "Second item with supporting detail" },
      { text: "Third item that rounds out the set" },
    ],
    style: "bullet",
  },
  render: List,
};

export const meta = defineMeta({
  title: 'List',
  description: 'Bullet, numbered, or checkmark list of text items; use for simple inline content lists.',
  categories: ["content"],
});
