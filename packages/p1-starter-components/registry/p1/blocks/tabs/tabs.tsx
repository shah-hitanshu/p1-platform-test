"use client";
import * as React from "react";
import { RichValue } from "@/registry/p1/internal/rich";
import "./tabs.css";

export interface TabItem {
  label: string;
  body: string;
}

export interface TabsProps {
  heading: string;
  align: "left" | "center";
  tabs: TabItem[];
}

export function TabsRender({ heading, align, tabs }: TabsProps) {
  const list = tabs || [];
  const [active, setActive] = React.useState(list[0]?.label ?? "");
  // Stay on a valid tab after the author reorders or deletes tabs.
  const activeLabel = list.some((t) => t.label === active) ? active : (list[0]?.label ?? "");
  const i = list.findIndex((t) => t.label === activeLabel);
  return (
    <div className="p1-tabs p1-block" data-align={align}>
      {heading && <h2 className="p1-tabs__heading">{heading}</h2>}
      <div className="p1-tabs__bar" role="tablist">
        {list.map((tb, ti) => {
          const on = tb.label === activeLabel;
          return (
            <button
              key={tb.label || ti}
              type="button"
              role="tab"
              aria-selected={on}
              data-active={on ? "true" : undefined}
              onClick={() => setActive(tb.label)}
              className="p1-tabs__tab"
            >
              {tb.label || `Tab ${ti + 1}`}
            </button>
          );
        })}
      </div>
      <div className="p1-tabs__panel" role="tabpanel">
        <RichValue value={(list[i] ?? ({} as TabItem)).body ?? ""} />
      </div>
    </div>
  );
}
