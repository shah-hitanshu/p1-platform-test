import * as React from "react";
import type { ComponentConfig } from "@puckeditor/core";
import { RichValue, RICH_PROSE } from "../internal/rich";
import { Icon } from "../internal/icons";

export interface AccordionItem {
  title: string;
  body: string;
}
export interface AccordionProps {
  heading: string;
  align: "left" | "center";
  items: AccordionItem[];
}

const AccordionView: React.FC<AccordionProps> = ({ heading, align, items }) => {
  const [open, setOpen] = React.useState<Record<number, boolean>>({ 0: true });
  const list = items || [];
  return (
    <div className="mx-auto max-w-3xl px-p1-lg py-p1-xl">
      {heading && (
        <h2
          className={`mb-p1-lg text-3xl font-bold tracking-tight text-p1-text md:text-4xl ${
            align === "center" ? "text-center" : "text-left"
          }`}
        >
          {heading}
        </h2>
      )}
      <div className="border-t border-p1-border">
        {list.map((it, ii) => {
          const isOpen = !!open[ii];
          return (
            <div key={ii} className="border-b border-p1-border">
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [ii]: !o[ii] }))}
                className="flex w-full items-center justify-between gap-p1-md py-p1-md text-left"
              >
                <span className="text-lg font-bold leading-snug text-p1-text">
                  {it.title || `Item ${ii + 1}`}
                </span>
                <Icon
                  name="plus"
                  className={`h-5 w-5 flex-none text-p1-text-muted transition-transform ${
                    isOpen ? "rotate-45" : ""
                  }`}
                />
              </button>
              {isOpen && (
                <div className="pb-p1-lg">
                  <RichValue value={it.body || ""} className={RICH_PROSE} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AccordionBlock: ComponentConfig<AccordionProps> = {
  fields: {
    heading: { type: "text", contentEditable: true, visible: false },
    align: {
      type: "radio",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    items: {
      type: "array",
      arrayFields: {
        title: { type: "text", contentEditable: true, visible: false },
        // visible in the array-item editor so every section is editable; the
        // open section is also click-to-edit on the canvas.
        body: { type: "richtext", contentEditable: true },
      },
      defaultItemProps: { title: "Section title", body: "<p>Section content.</p>" },
      getItemSummary: (item) => item.title || "Section",
    },
  },
  defaultProps: {
    heading: "The details",
    align: "left",
    items: [
      {
        title: "What frameworks are supported?",
        body: "<p>WordPress, Drupal, and Next.js — all on the same platform, with the same <mark>Dev-Test-Live</mark> workflow.</p>",
      },
      {
        title: "How do environments work?",
        body: "<p>Every site gets Dev, Test, and Live — plus unlimited Multidev branches for parallel work.</p><ul><li>Isolated by default</li><li>Shareable preview URLs</li><li>One-click promotion</li></ul>",
      },
      {
        title: "Can the whole team use it?",
        body: "<p>Yes. Developers, marketers, and IT share one workflow with role-based access — no one waits on anyone else.</p>",
      },
    ],
  },
  render: (props) => <AccordionView {...props} />,
};
