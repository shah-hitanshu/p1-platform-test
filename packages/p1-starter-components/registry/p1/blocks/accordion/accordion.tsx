"use client";
import * as React from "react";
import { Icon } from "@/registry/p1/internal/icons";
import { RichValue } from "@/registry/p1/internal/rich";
import "./accordion.css";

export interface AccordionItem {
  title: string;
  body: string;
}

export interface AccordionProps {
  heading: string;
  align: "left" | "center";
  items: AccordionItem[];
}

export function AccordionRender({ heading, align, items }: AccordionProps) {
  const list = items || [];
  const [open, setOpen] = React.useState<Record<string, boolean>>(
    list[0] ? { [list[0].title]: true } : {},
  );
  return (
    <div className="p1-accordion p1-block" data-align={align}>
      {heading && <h2 className="p1-accordion__heading">{heading}</h2>}
      <div className="p1-accordion__list">
        {list.map((it, ii) => {
          const key = it.title || String(ii);
          const isOpen = !!open[key];
          return (
            <div key={key} className="p1-accordion__item" data-open={isOpen ? "true" : undefined}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                className="p1-accordion__trigger"
              >
                <span className="p1-accordion__title">{it.title || `Item ${ii + 1}`}</span>
                <Icon name="plus" className="p1-accordion__icon" />
              </button>
              {isOpen && (
                <div className="p1-accordion__body">
                  <RichValue value={it.body || ""} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
