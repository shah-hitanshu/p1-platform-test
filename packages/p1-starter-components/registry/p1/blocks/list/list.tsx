import type { ComponentConfig } from "@puckeditor/core";
import { Icon } from "@/registry/p1/internal/icons";

export interface ListItem {
  text: string;
}
export interface ListProps {
  style: "check" | "bullet" | "numbered";
  items: ListItem[];
}

export const ListBlock: ComponentConfig<ListProps> = {
  fields: {
    style: {
      type: "select",
      options: [
        { label: "Check", value: "check" },
        { label: "Bullet", value: "bullet" },
        { label: "Numbered", value: "numbered" },
      ],
    },
    items: {
      type: "array",
      arrayFields: { text: { type: "text", contentEditable: true, visible: false } },
      defaultItemProps: { text: "List item" },
      getItemSummary: (item) => item.text || "Item",
    },
  },
  defaultProps: {
    style: "check",
    items: [
      { text: "Fast, reliable performance" },
      { text: "Simple, visual editing" },
      { text: "Works across your whole team" },
      { text: "Secure by default" },
    ],
  },
  render: ({ style, items }) => (
    <div className="mx-auto max-w-6xl px-p1-lg py-p1-sm">
      <ul className="m-0 flex max-w-2xl list-none flex-col gap-p1-sm p-0">
        {(items || []).map((it, i) => (
          <li key={i} className="flex items-start gap-p1-sm text-base font-medium leading-snug text-p1-text md:text-lg">
            {style === "numbered" ? (
              <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-p1-primary text-xs font-bold text-white">
                {i + 1}
              </span>
            ) : style === "bullet" ? (
              <span className="mt-2.5 h-2 w-2 flex-none rounded-full bg-p1-primary" />
            ) : (
              <span className="mt-0.5 grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-p1-success/10 text-p1-success">
                <Icon name="check" strokeWidth={2.4} className="h-3.5 w-3.5" />
              </span>
            )}
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  ),
};
