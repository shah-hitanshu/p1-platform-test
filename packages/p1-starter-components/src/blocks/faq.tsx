import type { ComponentConfig } from "@puckeditor/core";
import { Icon } from "../internal/icons";

export interface FaqItem {
  q: string;
  a: string;
}
export interface FaqProps {
  heading: string;
  items: FaqItem[];
}

export const FaqBlock: ComponentConfig<FaqProps> = {
  fields: {
    heading: { type: "text", contentEditable: true, visible: false },
    items: {
      type: "array",
      arrayFields: { q: { type: "text", contentEditable: true, visible: false }, a: { type: "textarea", contentEditable: true, visible: false } },
      defaultItemProps: { q: "Question?", a: "Answer." },
      getItemSummary: (item) => item.q || "Question",
    },
  },
  defaultProps: {
    heading: "Frequently asked questions",
    items: [
      { q: "Do I need a developer to make changes?", a: "No. Anyone on your team can edit pages visually with ready-made blocks — no code required." },
      { q: "Can I use my own components?", a: "Yes. Developers can add custom blocks once, and the whole team can reuse them." },
      { q: "How do previews work?", a: "Every change gets a shareable preview link, so you can review before publishing." },
    ],
  },
  render: ({ heading, items }) => (
    <div className="bg-p1-bg-default px-p1-lg py-p1-xl">
      <div className="mx-auto max-w-3xl">
        {heading && (
          <h2 className="mb-p1-xl text-center text-3xl font-bold tracking-tight text-p1-text md:text-4xl">{heading}</h2>
        )}
        <div className="border-t border-p1-border">
          {(items || []).map((item, i) => (
            <div key={i} className="border-b border-p1-border py-p1-md">
              <div className="flex items-start justify-between gap-p1-md">
                <h3 className="text-lg font-bold leading-snug text-p1-text">{item.q}</h3>
                <Icon name="plus" className="mt-1 h-5 w-5 flex-none text-p1-text-muted" />
              </div>
              <p className="mt-p1-sm max-w-[92%] leading-relaxed text-p1-text-muted">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
};
