import * as React from "react";
import type { ComponentConfig} from "@puckeditor/core";
import { type Slot } from "@puckeditor/core";

export interface ColumnsProps {
  distribution: "1:1" | "1:1:1" | "2:1" | "1:2" | "1:1:1:1";
  gap: "tight" | "regular" | "wide";
  valign: "top" | "center" | "stretch";
  tone: "none" | "light";
  col1: Slot;
  col2: Slot;
  col3: Slot;
  col4: Slot;
}

const TEMPLATES: Record<ColumnsProps["distribution"], { count: number; template: string }> = {
  "1:1": { count: 2, template: "1fr 1fr" },
  "2:1": { count: 2, template: "1.5fr 1fr" },
  "1:2": { count: 2, template: "1fr 1.5fr" },
  "1:1:1": { count: 3, template: "1fr 1fr 1fr" },
  "1:1:1:1": { count: 4, template: "1fr 1fr 1fr 1fr" },
};
const GAP: Record<ColumnsProps["gap"], string> = {
  tight: "gap-p1-md",
  regular: "gap-p1-lg",
  wide: "gap-p1-xl",
};
const VALIGN: Record<ColumnsProps["valign"], string> = {
  top: "items-start",
  center: "items-center",
  stretch: "items-stretch",
};

const SlotPlaceholder = ({ label }: { label: string }) => (
  <div className="rounded-p1-md border border-dashed border-p1-border p-p1-lg text-center text-sm text-p1-text-muted">
    {label}
  </div>
);

/** Render a slot prop safely. In the Puck editor the value is a render
 *  component (Puck's `SlotComponent`); in Storybook / static use it may be an
 *  empty content array, in which case we show a placeholder. Typed as
 *  `unknown` so it accepts whatever shape Puck's render-time prop transform
 *  hands over. */
function renderSlot(slot: unknown, label: string) {
  if (typeof slot === "function") {
    const Comp = slot as React.ComponentType;
    return <Comp />;
  }
  return <SlotPlaceholder label={label} />;
}

export const ColumnsBlock: ComponentConfig<ColumnsProps> = {
  fields: {
    distribution: {
      type: "select",
      options: [
        { label: "Two — even", value: "1:1" },
        { label: "Two — left wide", value: "2:1" },
        { label: "Two — right wide", value: "1:2" },
        { label: "Three", value: "1:1:1" },
        { label: "Four", value: "1:1:1:1" },
      ],
    },
    gap: {
      type: "select",
      options: [
        { label: "Tight", value: "tight" },
        { label: "Regular", value: "regular" },
        { label: "Wide", value: "wide" },
      ],
    },
    valign: {
      type: "select",
      options: [
        { label: "Top", value: "top" },
        { label: "Center", value: "center" },
        { label: "Stretch", value: "stretch" },
      ],
    },
    tone: {
      type: "radio",
      options: [
        { label: "None", value: "none" },
        { label: "Light", value: "light" },
      ],
    },
    col1: { type: "slot" },
    col2: { type: "slot" },
    col3: { type: "slot" },
    col4: { type: "slot" },
  },
  defaultProps: {
    distribution: "1:1",
    gap: "regular",
    valign: "top",
    tone: "none",
    col1: [],
    col2: [],
    col3: [],
    col4: [],
  },
  render: ({ distribution, gap, valign, tone, col1, col2, col3, col4 }) => {
    const { count, template } = TEMPLATES[distribution];
    const slots = [col1, col2, col3, col4].slice(0, count);
    return (
      <div className={`py-p1-lg px-p1-lg ${tone === "light" ? "bg-p1-bg-light" : ""}`}>
        <div
          className={`mx-auto grid max-w-7xl ${GAP[gap]} ${VALIGN[valign]}`}
          style={{ gridTemplateColumns: template }}
        >
          {slots.map((slot, i) => (
            <div key={i} className="min-w-0">
              {renderSlot(slot, `Column ${i + 1} — drop blocks here`)}
            </div>
          ))}
        </div>
      </div>
    );
  },
};
